/** 统计每张截图里认出的元素徽章（只计高置信），用于判断单元素/双元素 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { COLS, ROWS, fitGrid } from '../src/core/ocr/fit'
import { ELEMENT_GLYPHS, GEO, TH } from '../src/core/ocr/model'
import { bestCorrelation, darkRatio, fromRgba } from '../src/core/ocr/sampling'
import { IMAGE_RE, readImage } from './image-io'

const dir = 'tests/fixtures/ocr'
for (const file of readdirSync(dir).filter((f) => IMAGE_RE.test(f) && f.includes(process.argv[2] ?? '')).sort()) {
  const raw = readImage(join(dir, file))
  const img = fromRgba(raw.width, raw.height, raw.data)
  const { grid } = fitGrid(img)
  const hist: Record<string, number> = {}
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (darkRatio(img, grid, r, c, GEO.badgeBox) <= TH.anchorCandidate) continue
      const s = [...ELEMENT_GLYPHS.entries()].map(([k, t]) => [k, bestCorrelation(img, grid, r, c, GEO.elementBox, t)] as const).sort((a, b) => b[1] - a[1])
      const [k, v] = s[0]
      if (v >= TH.glyphCorr && v - s[1][1] >= TH.glyphMargin && v + 2 * (v - s[1][1]) >= TH.glyphCombined) hist[k] = (hist[k] ?? 0) + 1
    }
  }
  console.log(file.padEnd(40), Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}${n}`).join(' '))
}
