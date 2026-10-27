import { writeFileSync } from 'node:fs'
import { readImage } from './image-io'
import { fromRgba } from '../src/core/ocr/sampling'
import { awakenGlyph } from '../src/core/ocr/awaken'
import manifest from '../tests/fixtures/ocr/manifest.json'

const sources = [
  { file: 'ingame-earth-01.jpg', index: 0, value: 1 },
  { file: 'outgame-metal-01.jpg', index: 0, value: 2 },
  { file: 'outgame-fire-01.jpg', index: 0, value: 3 },
]
const templates = sources.map(({ file, index, value }) => {
  const fixture = manifest.fixtures.find((f) => f.file === file)!
  const red = fixture.reds[index]
  if (red.awaken !== value) throw new Error('样本标注不一致')
  const raw = readImage(`tests/fixtures/ocr/${file}`)
  const [row, col] = [...red.cells].sort((a, b) => b[0] - a[0] || b[1] - a[1])[0]
  const { ox, oy, pitch } = fixture.grid
  const glyph = awakenGlyph(fromRgba(raw.width, raw.height, raw.data), { ox, oy, pw: pitch, ph: pitch }, row, col)
  if (!glyph) throw new Error(`无法提取字形：${file} 觉醒${value}`)
  return { value, mask: glyph.mask, source: `${file}#${index}` }
})
writeFileSync('src/core/data/raw/awaken-glyphs.json', JSON.stringify({ width: 16, height: 20, templates }) + '\n')
console.log(`生成 ${templates.length} 种觉醒字形，未覆盖等级保留待确认`)
