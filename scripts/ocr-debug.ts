/**
 * 截图识别调试：对 tests/fixtures/ocr 下的截图跑网格定位，输出结果，并生成叠加了网格线的背包区域小图。
 * 用法：npx tsx scripts/ocr-debug.ts [输出目录，默认 /tmp/ocr-debug] [文件名过滤，可选]
 */
import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { COLS, ROWS, fitGrid } from '../src/core/ocr/fit'
import { fromRgba } from '../src/core/ocr/sampling'
import { IMAGE_RE, cropScale, readImage, writeJpeg } from './image-io'

const dir = 'tests/fixtures/ocr'
const out = process.argv[2] ?? '/tmp/ocr-debug'
const filter = process.argv[3] ?? ''
mkdirSync(out, { recursive: true })

const files = readdirSync(dir).filter((f) => IMAGE_RE.test(f) && f.includes(filter)).sort()
for (const file of files) {
  const raw = readImage(join(dir, file))
  const img = fromRgba(raw.width, raw.height, raw.data)
  const t0 = performance.now()
  const fit = fitGrid(img)
  const ms = Math.round(performance.now() - t0)
  const { ox, oy, pw, ph } = fit.grid
  console.log(JSON.stringify({
    file, size: [raw.width, raw.height], ms, converged: fit.converged,
    score: +fit.score.toFixed(1), anchors: fit.anchors, frame: +fit.frame.toFixed(2), ox: +ox.toFixed(1), oy: +oy.toFixed(1), pitch: +pw.toFixed(2),
  }))

  // 画网格线（2px 青色）
  const d = raw.data
  const dot = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= raw.width || y >= raw.height) return
    const i = (y * raw.width + x) * 4
    d[i] = 0; d[i + 1] = 255; d[i + 2] = 255
  }
  for (let r = 0; r <= ROWS; r++) {
    const y = Math.round(oy + r * ph)
    for (let x = Math.round(ox); x <= Math.round(ox + COLS * pw); x++) { dot(x, y); dot(x, y - 1) }
  }
  for (let c = 0; c <= COLS; c++) {
    const x = Math.round(ox + c * pw)
    for (let y = Math.round(oy); y <= Math.round(oy + ROWS * ph); y++) { dot(x, y); dot(x - 1, y) }
  }
  const pad = pw * 0.6
  const crop = cropScale(raw, ox - pad, oy - pad, COLS * pw + 2 * pad, ROWS * ph + 2 * pad, 760)
  writeJpeg(join(out, file.replace(IMAGE_RE, '.jpg')), crop)
}
console.log(`叠加图已写入 ${out}`)
