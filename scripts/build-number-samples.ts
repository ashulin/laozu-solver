/** 从全部夹具截图提取共鸣数字的「白色 mask」样本，生成识别用的补充模板数据。
 *
 * 背景：内置数字模板（MODEL.templates.number）是旧版数据移植的，与不同批次截图的
 * 渲染细节有偏差，分数天花板 0.6~0.7。真实圆章之间的同值相关性实测 0.95。
 * 本脚本从夹具里识别 confirmed 的法宝格提取白色 mask（18x18 归一化覆盖率向量），
 * 按共鸣值去重（互相关 > 0.97 视为重复）后每值保留最多 3 个，量化为 int8 存储。
 * 运行时 readNumber 在内置模板与这些样本模板之间取最大分。
 */
import { writeFileSync } from 'node:fs'
import { GAME } from '../src/core/data'
import { recognizeGrid, resonanceOf } from '../src/core/ocr/recognize'
import { GEO } from '../src/core/ocr/model'
import { fromRgba, type Grid, type RgbImage } from '../src/core/ocr/sampling'
import { readImage } from './image-io'
import manifest from '../tests/fixtures/ocr/manifest.json'

const S = 18
const BOX = GEO.numberBox
const WHITE_MIN = 150
const WHITE_SAT = 60

function tailOffset(shapeId: number): [number, number] {
  const sorted = [...GAME.shapeById[shapeId].cells].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  return [last[0] - first[0], last[1] - first[1]]
}

/** box 区域白色 mask → 18x18 覆盖率（子格 3x3 像素窗），归一化 */
function whitePatch(img: RgbImage, grid: Grid, row: number, col: number): number[] | null {
  const bx0 = grid.ox + (col + BOX[0]) * grid.pw
  const by0 = grid.oy + (row + BOX[1]) * grid.ph
  const step = (BOX[2] - BOX[0]) * grid.pw / S
  const v: number[] = []
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const cx = Math.round(bx0 + (i + 0.5) * step)
      const cy = Math.round(by0 + (j + 0.5) * step)
      let hit = 0
      let total = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue
        total++
        const [r, g, b] = img.px(x, y)
        if (Math.min(r, g, b) > WHITE_MIN && Math.max(r, g, b) - Math.min(r, g, b) < WHITE_SAT) hit++
      }
      v.push(total ? hit / total : 0)
    }
  }
  const mean = v.reduce((a, b) => a + b, 0) / v.length
  if (mean < 0.05) return null // 没有数字笔画
  let sd = 0
  for (const p of v) sd += (p - mean) ** 2
  sd = Math.sqrt(sd / v.length)
  if (!sd) return null
  return v.map((p) => (p - mean) / sd)
}

const corr = (a: number[], b: number[]) => a.reduce((acc, x, i) => acc + x * b[i], 0)

interface Sample { value: number; patch: number[]; file: string }
const samples: Sample[] = []
for (const f of manifest.fixtures) {
  const raw = readImage(`tests/fixtures/ocr/${f.file}`)
  const img = fromRgba(raw.width, raw.height, raw.data)
  const grid: Grid = { ox: f.grid.ox, oy: f.grid.oy, pw: f.grid.pitch, ph: f.grid.pitch }
  const res = recognizeGrid(img, grid)
  for (const cell of res.cells) {
    if (cell.kind !== 'piece' || !cell.equipId) continue
    const eq = GAME.equipById[cell.equipId]
    const value = resonanceOf(eq.id)
    if (value === null) continue
    const [dr, dc] = tailOffset(eq.shapeId)
    const r = cell.row + dr
    const c = cell.col + dc
    if (r > 5 || c > 6) continue
    const patch = whitePatch(img, grid, r, c)
    if (patch) samples.push({ value, patch, file: f.file })
  }
}
console.log('原始样本', samples.length)

// 按值去重：贪心保留互相差异最大的，每值最多 3 个
const byValue = new Map<number, Sample[]>()
for (const s of samples) {
  const list = byValue.get(s.value) ?? []
  // 与已选样本过于相似的丢弃
  if (list.some((k) => corr(k.patch, s.patch) > 0.97)) continue
  list.push(s)
  byValue.set(s.value, list)
}
const kept: Sample[] = []
for (const [value, list] of byValue) {
  list.sort((a, b) => corr(b.patch, b.patch)) // 顺序无关，保持稳定
  kept.push(...list.slice(0, 3))
}

// 量化 int8（-1..1 → -127..127）→ base64
const encode = (patch: number[]) => {
  const bytes = new Uint8Array(patch.length)
  for (let i = 0; i < patch.length; i++) bytes[i] = Math.max(-127, Math.min(127, Math.round(patch[i] * 127))) + 128
  return Buffer.from(bytes).toString('base64')
}
const byValueOut: Record<string, string[]> = {}
for (const s of kept) (byValueOut[s.value] ??= []).push(encode(s.patch))

writeFileSync('src/core/data/raw/number-samples.json', JSON.stringify({
  size: S,
  comment: '共鸣数字白色 mask 样本（18x18 覆盖率，int8 量化）。由 build-number-samples.ts 从夹具截图提取，运行时与内置数字模板取最大分。',
  samples: byValueOut,
}, null, 1) + '\n')
const dist = Object.entries(byValueOut).map(([v, list]) => `${v}:${list.length}`).join(' ')
console.log(`保留 ${kept.length} 个样本：${dist}`)
