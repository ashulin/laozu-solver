/**
 * 截图识别调试：对 tests/fixtures/ocr 下的截图跑网格定位，输出结果并生成叠加了网格线的图片。
 * 用法：npx tsx scripts/ocr-debug.ts [输出目录，默认 /tmp/ocr-debug]
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import jpeg from 'jpeg-js'
import { COLS, ROWS, fitGrid } from '../src/core/ocr/fit'
import { fromRgba } from '../src/core/ocr/sampling'

const dir = 'tests/fixtures/ocr'
const out = process.argv[2] ?? '/tmp/ocr-debug'
mkdirSync(out, { recursive: true })

for (const file of readdirSync(dir).filter((f) => /\.(jpe?g)$/i.test(f)).sort()) {
  const raw = jpeg.decode(readFileSync(join(dir, file)), { useTArray: true, maxMemoryUsageInMB: 1024 })
  const img = fromRgba(raw.width, raw.height, raw.data)
  const t0 = performance.now()
  const fit = fitGrid(img)
  const ms = Math.round(performance.now() - t0)
  const { ox, oy, pw, ph } = fit.grid
  console.log(`${file}  ${raw.width}×${raw.height}  ${ms}ms  converged=${fit.converged}  score=${fit.score.toFixed(1)}  anchors=${fit.anchors}  grid=(${ox.toFixed(1)}, ${oy.toFixed(1)}) pitch=${pw.toFixed(2)}`)

  // 画网格线（2px 青色）
  const d = raw.data
  const line = (x: number, y: number) => {
    for (let k = -1; k <= 0; k++) {
      for (const [xx, yy] of [[x + k, y], [x, y + k]]) {
        if (xx < 0 || yy < 0 || xx >= raw.width || yy >= raw.height) continue
        const i = (yy * raw.width + xx) * 4
        d[i] = 0; d[i + 1] = 255; d[i + 2] = 255
      }
    }
  }
  for (let r = 0; r <= ROWS; r++) {
    const y = Math.round(oy + r * ph)
    for (let x = Math.round(ox); x <= Math.round(ox + COLS * pw); x++) line(x, y)
  }
  for (let c = 0; c <= COLS; c++) {
    const x = Math.round(ox + c * pw)
    for (let y = Math.round(oy); y <= Math.round(oy + ROWS * ph); y++) line(x, y)
  }
  writeFileSync(join(out, file), jpeg.encode({ width: raw.width, height: raw.height, data: d }, 85).data)
}
console.log(`叠加图已写入 ${out}`)
