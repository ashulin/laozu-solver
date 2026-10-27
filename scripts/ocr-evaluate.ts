import { GAME } from '../src/core/data'
import { recognizeGrid } from '../src/core/ocr/recognize'
import { needsReview } from '../src/core/ocr/draft'
import { fromRgba } from '../src/core/ocr/sampling'
import manifest from '../tests/fixtures/ocr/manifest.json'
import { readImage } from './image-io'

let correct = 0, total = 0
for (const fixture of manifest.fixtures) {
  if (process.argv[2] && !fixture.file.includes(process.argv[2])) continue
  const raw = readImage(`tests/fixtures/ocr/${fixture.file}`)
  const img = fromRgba(raw.width, raw.height, raw.data)
  const { ox, oy, pitch } = fixture.grid
  const started = performance.now()
  const result = recognizeGrid(img, { ox, oy, pw: pitch, ph: pitch })
  const pieces = result.cells.filter((c) => c.kind === 'piece')
  console.log(fixture.file, `${Math.round(performance.now() - started)}ms`, `${pieces.length}件`, `待核对${pieces.filter(needsReview).length}`, `未知格${result.cells.filter((c) => c.kind === 'unknown').length}`)
  for (const red of fixture.reds) {
    total++
    const c = result.cells[red.anchor[0] * 7 + red.anchor[1]]
    if (c.equipId && GAME.equipById[c.equipId].name === red.name) correct++
    else console.log('  MISMATCH', red.name, red.anchor, JSON.stringify(c))
  }
  if (process.argv[2]) for (const c of result.cells.filter((c) => c.kind !== 'covered')) {
    console.log(`  ${c.row},${c.col}`, c.kind, c.equipId ? `${GAME.equipById[c.equipId].name} ${GAME.equipById[c.equipId].tier}阶` : '', !needsReview(c), c.conflicts?.join('；') ?? '',
      c.candidates.map((a) => `${GAME.equipById[a.equipId].name}/${GAME.equipById[a.equipId].tier}:${a.distance}`).join(' '))
  }
}
console.log(`已人工标注的红装名称/锚点：${correct}/${total}；其余法宝尚无完整人工真值，不计入准确率。`)
