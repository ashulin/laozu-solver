import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { GAME, isPlayableEquip } from '../src/core/data'
import { readImage } from './image-io'

const directory = process.argv[2]
if (!directory) throw new Error('Usage: npx tsx scripts/build-ocr-library.ts /path/to/library')
const entries: { id: number; name: string; source: string }[] = JSON.parse(readFileSync(join(directory, 'library.json'), 'utf8'))
const sources: Record<string, number> = {}
const templates = entries.flatMap((entry) => {
  const eq = GAME.equipById[entry.id]
  if (!eq || !isPlayableEquip(eq)) return []
  const shape = GAME.shapeById[eq.shapeId]
  const image = readImage(join(directory, `${entry.id}.png`))
  const points: number[] = []
  const ox = (shape.w - image.width / 256) / 2
  const oy = (shape.h - image.height / 256) / 2
  const step = Math.max(8, Math.sqrt(image.width * image.height / 320))
  for (let y = step / 2; y < image.height; y += step) {
    for (let x = step / 2; x < image.width; x += step) {
      const fx = ox + x / 256
      const fy = oy + y / 256
      if (!shape.cells.some(([r, c]) => Math.floor(fx) === c && Math.floor(fy) === r)) continue
      const px = fx % 1, py = fy % 1
      // 跳过左上元素/形态标与右下共鸣数字，这些叠加物在原生图里不存在
      if (px < 0.30 && py < 0.48 || px > 0.70 && py > 0.64) continue
      let r = 0, g = 0, b = 0, a = 0
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const sy = Math.max(0, Math.min(image.height - 1, Math.round(y + dy)))
        const sx = Math.max(0, Math.min(image.width - 1, Math.round(x + dx)))
        const i = (sy * image.width + sx) * 4
        r += image.data[i]; g += image.data[i + 1]; b += image.data[i + 2]; a += image.data[i + 3]
      }
      if (a / 25 < 245) continue
      points.push(Math.round(fx * 1000), Math.round(fy * 1000), Math.round(r / 25), Math.round(g / 25), Math.round(b / 25))
    }
  }
  if (points.length < 50) throw new Error(`Not enough opaque samples: ${entry.id}`)
  sources[entry.source] = (sources[entry.source] ?? 0) + 1
  return [{ id: entry.id, points }]
})
const missing = GAME.equips.filter(isPlayableEquip).filter((e) => !templates.some((t) => t.id === e.id))
if (missing.length) throw new Error(`Missing native art: ${missing.map((e) => e.id).join(',')}`)
const output = resolve('src/core/data/raw/ocr-library.json')
writeFileSync(output, JSON.stringify({ version: 1, units: 1000, sources, templates }) + '\n')
console.log(`${templates.length} templates; ${JSON.stringify(sources)}; ${readFileSync(output).length} bytes`)
