/** 诊断：逐格打印徽章候选与元素字形匹配情况。用法：npx tsx scripts/ocr-glyph.ts 文件名 [整行平移数] */
import { join } from 'node:path'
import { COLS, ROWS, fitGrid } from '../src/core/ocr/fit'
import { ELEMENT_GLYPHS, GEO, TH } from '../src/core/ocr/model'
import { bestCorrelation, darkRatio, fromRgba } from '../src/core/ocr/sampling'
import { readImage } from './image-io'

const [file, shiftArg] = process.argv.slice(2)
const raw = readImage(join('tests/fixtures/ocr', file))
const img = fromRgba(raw.width, raw.height, raw.data)
const fit = fitGrid(img)
const g = { ...fit.grid, oy: fit.grid.oy + Number(shiftArg ?? 0) * fit.grid.ph }
for (let r = 0; r < ROWS; r++) {
  const cells: string[] = []
  for (let c = 0; c < COLS; c++) {
    const dark = darkRatio(img, g, r, c, GEO.badgeBox)
    if (dark <= TH.anchorCandidate) { cells.push(`  ·  ${dark.toFixed(2)}   `); continue }
    const scores = [...ELEMENT_GLYPHS.entries()].map(([k, t]) => [k, bestCorrelation(img, g, r, c, GEO.elementBox, t)] as const).sort((a, b) => b[1] - a[1])
    const [k1, v1] = scores[0]
    const v2 = scores[1][1]
    const ok = v1 >= TH.glyphCorr && v1 - v2 >= TH.glyphMargin && v1 + 2 * (v1 - v2) >= TH.glyphCombined
    cells.push(`${ok ? '✓' : '✗'}${k1}${v1.toFixed(2)}/${(v1 - v2).toFixed(2)}`)
  }
  console.log(`row ${r}  ${cells.join(' | ')}`)
}
