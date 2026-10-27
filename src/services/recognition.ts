import type { Grid } from '@/core/ocr/sampling'
import type { RecognizeJob, RecognizeMessage } from '@/workers/recognize.worker'

/** 在解码像素前检查文件头尺寸，限制高压缩图片的解码内存。 */
export function screenshotDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length))
  const checked = (width: number, height: number) => {
    if (width < 1 || height < 1 || width * height > 32_000_000 || Math.max(width, height) > 32768) {
      throw new Error('图片尺寸无效或超过 3200 万像素，请缩小后重试')
    }
    return { width, height }
  }
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && text(12, 4) === 'IHDR') {
    return checked(view.getUint32(16), view.getUint32(20))
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue
      if (offset + 2 > bytes.length) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
        return checked(view.getUint16(offset + 5), view.getUint16(offset + 3))
      }
      offset += length
    }
  }
  if (bytes.length >= 30 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    const kind = text(12, 4)
    if (kind === 'VP8X') {
      if (bytes[20] & 2) throw new Error('请使用静态截图，不支持动态 WebP')
      const u24 = (i: number) => bytes[i] + (bytes[i + 1] << 8) + (bytes[i + 2] << 16)
      return checked(1 + u24(24), 1 + u24(27))
    }
    if (kind === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true)
      return checked((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
    }
    if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return checked(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff)
    }
  }
  throw new Error('无法读取图片尺寸，请重新保存为标准 PNG、JPG 或静态 WebP')
}

export async function decodeScreenshot(file: File): Promise<ImageData> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) && !(file.type === '' && /\.(png|jpe?g|webp)$/i.test(file.name))) {
    throw new Error('请选择 PNG、JPG 或 WebP 截图')
  }
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('图片须大于 0 且不超过 20 MB')
  screenshotDimensions(new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer()))
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 32_000_000) {
      throw new Error('图片尺寸无效或超过 3200 万像素，请缩小后重试')
    }
    const scale = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.naturalWidth * scale)
    canvas.height = Math.round(image.naturalHeight * scale)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('当前浏览器不支持 Canvas，请使用新版浏览器')
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return ctx.getImageData(0, 0, canvas.width, canvas.height)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function runRecognition(image: ImageData, grid: Grid | undefined, signal: AbortSignal, progress: (message: string) => void) {
  return new Promise<Extract<RecognizeMessage, { type: 'done' }>>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('已取消', 'AbortError')); return }
    const worker = new Worker(new URL('../workers/recognize.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => { worker.terminate(); signal.removeEventListener('abort', abort); clearTimeout(timer) }
    const fail = (error: Error) => { cleanup(); reject(error) }
    const abort = () => fail(new DOMException('已取消', 'AbortError'))
    const timer = setTimeout(() => fail(new Error('识别超时，请尝试裁剪背包区域或手动框选')), 90_000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }: MessageEvent<RecognizeMessage>) => {
      if (data.type === 'progress') progress(data.message)
      else if (data.type === 'error') fail(new Error(data.message))
      else { cleanup(); resolve(data) }
    }
    worker.onerror = () => fail(new Error('识别模块加载失败，请刷新重试；当前背包没有改动'))
    worker.onmessageerror = () => fail(new Error('无法读取识别结果，请重试'))
    const pixels = new Uint8ClampedArray(image.data)
    const job: RecognizeJob = { w: image.width, h: image.height, pixels, grid }
    try { worker.postMessage(job, [pixels.buffer]) } catch (error) { fail(error instanceof Error ? error : new Error('无法启动识别')) }
  })
}
