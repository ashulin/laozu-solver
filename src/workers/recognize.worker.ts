import { fitGrid } from '@/core/ocr/fit'
import type { OcrSample } from '@/core/ocr/learn'
import { recognizeGrid, type RecognitionResult } from '@/core/ocr/recognize'
import { fromRgba, type Grid } from '@/core/ocr/sampling'

export interface RecognizeJob { w: number; h: number; pixels: Uint8ClampedArray; grid?: Grid; samples?: OcrSample[] }
export type RecognizeMessage =
  | { type: 'progress'; message: string }
  | { type: 'done'; grid: Grid; result: RecognitionResult | null }
  | { type: 'error'; message: string }

const send = (message: RecognizeMessage) => self.postMessage(message)
self.onmessage = (event: MessageEvent<RecognizeJob>) => {
  try {
    const { w, h, pixels } = event.data
    const image = fromRgba(w, h, pixels)
    let grid = event.data.grid
    if (!grid) {
      send({ type: 'progress', message: '正在自动定位 6×7 背包网格…' })
      const fit = fitGrid(image)
      grid = fit.grid
      if (!fit.converged) { send({ type: 'done', grid, result: null }); return }
    }
    send({ type: 'progress', message: '正在匹配法宝图案、品阶与占格…' })
    send({ type: 'done', grid, result: recognizeGrid(image, grid, event.data.samples ?? []) })
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : '识别失败，请重试或手动调整网格' })
  }
}
