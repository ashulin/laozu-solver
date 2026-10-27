import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { screenshotDimensions, runRecognition } from '@/services/recognition'
import type { RecognizeMessage } from '@/workers/recognize.worker'
import { FIXTURE_DIR, FIXTURES_AVAILABLE, manifest } from '../ocr/fixtures'

const pngHeader = (width: number, height: number) => {
  const data = new Uint8Array(24), view = new DataView(data.buffer)
  view.setUint32(0, 0x89504e47); view.setUint32(4, 0x0d0a1a0a); view.setUint32(12, 0x49484452)
  view.setUint32(16, width); view.setUint32(20, height)
  return data
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('截图解码前尺寸检查', () => {
  it('拒绝损坏/空/超大像素图像，无需解码像素', () => {
    expect(screenshotDimensions(pngHeader(1080, 2400))).toEqual({ width: 1080, height: 2400 })
    for (const bytes of [new Uint8Array(), new Uint8Array(64), pngHeader(100000, 100000), pngHeader(0, 1)]) {
      expect(() => screenshotDimensions(bytes)).toThrow()
    }
  })
  it.skipIf(!FIXTURES_AVAILABLE)('24张真实PNG/JPEG头部尺寸与标注一致', () => {
    for (const f of manifest.fixtures) {
      expect(screenshotDimensions(readFileSync(join(FIXTURE_DIR, f.file)).subarray(0, 1024 * 1024))).toEqual({ width: f.size[0], height: f.size[1] })
    }
  })
  it('解析WebP尺寸并拒绝动画', () => {
    const bytes = new Uint8Array(30)
    bytes.set(new TextEncoder().encode('RIFF'), 0); bytes.set(new TextEncoder().encode('WEBPVP8X'), 8)
    bytes[24] = 99; bytes[27] = 199
    expect(screenshotDimensions(bytes)).toEqual({ width: 100, height: 200 })
    bytes[20] = 2
    expect(() => screenshotDimensions(bytes)).toThrow('动态')
  })
})

class FakeWorker {
  static current: FakeWorker
  onmessage?: (event: { data: RecognizeMessage }) => void
  onerror?: () => void
  onmessageerror?: () => void
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() { FakeWorker.current = this }
}
const image = { width: 1, height: 1, data: new Uint8ClampedArray(4) } as ImageData

describe('识图Worker生命周期', () => {
  it('复制像素避免预览失效，完成后终止Worker', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const progress = vi.fn()
    const promise = runRecognition(image, undefined, new AbortController().signal, progress)
    const worker = FakeWorker.current
    expect(worker.postMessage.mock.calls[0][0].pixels).not.toBe(image.data)
    worker.onmessage?.({ data: { type: 'progress', message: '识别中' } })
    expect(progress).toHaveBeenCalledWith('识别中')
    worker.onmessage?.({ data: { type: 'done', grid: { ox: 0, oy: 0, pw: 10, ph: 10 }, result: null } })
    await expect(promise).resolves.toMatchObject({ type: 'done' })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it('取消和超时均释放Worker，调用方收到明确错误', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const controller = new AbortController()
    const promise = runRecognition(image, undefined, controller.signal, vi.fn())
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeWorker.current.terminate).toHaveBeenCalledOnce()
    vi.useFakeTimers()
    const timeout = runRecognition(image, undefined, new AbortController().signal, vi.fn())
    const check = expect(timeout).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(90000)
    await check
    expect(FakeWorker.current.terminate).toHaveBeenCalledOnce()
  })
})
