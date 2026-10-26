/** 诊断：给定格宽和左右位置，逐行/逐列打印「像背包格子」的程度，看网格外是否还有格子 */
import { join } from 'node:path'
import { fitGrid, COLS, ROWS } from '../src/core/ocr/fit'
import { cellBackground, fromRgba, paletteDistance, darkRatio } from '../src/core/ocr/sampling'
import { GEO, TH } from '../src/core/ocr/model'
import { readImage } from './image-io'

for (const file of process.argv.slice(2)) {
  const raw = readImage(join('tests/fixtures/ocr', file))
  const img = fromRgba(raw.width, raw.height, raw.data)
  const fit = fitGrid(img)
  const g = fit.grid
  console.log(`\n${file} fit oy=${g.oy.toFixed(1)} ox=${g.ox.toFixed(1)} p=${g.pw.toFixed(1)} anchors=${fit.anchors}`)
  for (let r = -3; r <= ROWS + 1; r++) {
    let s = 0
    let badge = 0
    const ds: number[] = []
    for (let c = 0; c < COLS; c++) {
      const bg = cellBackground(img, g, r, c)
      if (!bg) { ds.push(-1); continue }
      const d = paletteDistance(bg)
      ds.push(Math.round(d))
      s += Math.max(0, 1 - d / TH.fitFalloff)
      if (darkRatio(img, g, r, c, GEO.badgeBox) > TH.anchorCandidate) badge++
    }
    console.log(`row ${String(r).padStart(2)}  score ${s.toFixed(2).padStart(5)}  badges ${badge}  dist ${ds.join(' ')}${r >= 0 && r < ROWS ? '  ←' : ''}`)
  }
}
