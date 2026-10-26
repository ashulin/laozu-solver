/**
 * Node 端读写截图（测试与调试脚本共用，不进入网页打包）。
 * 浏览器端走 canvas.getImageData，同样产出 RGBA 字节数组，交给 fromRgba。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'

export interface RawImage {
  width: number
  height: number
  data: Uint8Array // RGBA
}

export const IMAGE_RE = /\.(jpe?g|png)$/i

export function readImage(path: string): RawImage {
  const buf = readFileSync(path)
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  if (isPng) {
    const png = PNG.sync.read(buf)
    return { width: png.width, height: png.height, data: new Uint8Array(png.data) }
  }
  const j = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 })
  return { width: j.width, height: j.height, data: j.data }
}

export function writeJpeg(path: string, img: RawImage, quality = 85): void {
  writeFileSync(path, jpeg.encode({ width: img.width, height: img.height, data: img.data }, quality).data)
}

/** 裁剪 + 等比缩小（最近邻），用于生成便于查看的小图 */
export function cropScale(img: RawImage, x0: number, y0: number, w: number, h: number, maxSide: number): RawImage {
  x0 = Math.max(0, Math.floor(x0))
  y0 = Math.max(0, Math.floor(y0))
  w = Math.min(img.width - x0, Math.ceil(w))
  h = Math.min(img.height - y0, Math.ceil(h))
  const k = Math.min(1, maxSide / Math.max(w, h))
  const ow = Math.max(1, Math.round(w * k))
  const oh = Math.max(1, Math.round(h * k))
  const out = new Uint8Array(ow * oh * 4)
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const sx = x0 + Math.min(w - 1, Math.floor(x / k))
      const sy = y0 + Math.min(h - 1, Math.floor(y / k))
      const si = (sy * img.width + sx) * 4
      const di = (y * ow + x) * 4
      out[di] = img.data[si]; out[di + 1] = img.data[si + 1]; out[di + 2] = img.data[si + 2]; out[di + 3] = 255
    }
  }
  return { width: ow, height: oh, data: out }
}
