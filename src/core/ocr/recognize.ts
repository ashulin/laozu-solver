import { GAME } from '../data'
import library from '../data/raw/ocr-library.json'
import { ELEMENT_NAME } from '../types'
import type { Equip } from '../types'
import { anchoredPiece, occupiedCells, validGrid } from './geometry'
import { detectAwaken } from './awaken'
import type { OcrSample } from './learn'
import { refreshConflicts } from './conflicts'
import { ELEMENT_GLYPHS, FORM_GLYPHS, FORM_ID, GEO, MODEL, NUMBER_GLYPHS, TH } from './model'
import { bestCorrelation, cellBackground, colorDistance, darkRatio, inBounds, type Grid, type RgbImage } from './sampling'

export type CellKind = 'empty' | 'locked' | 'unknown' | 'piece' | 'covered'
export interface Candidate { equipId: number; distance: number }
export interface RecognitionCell {
  row: number
  col: number
  kind: CellKind
  equipId: number | null
  awaken: number | null
  awakenDetected?: boolean
  anchorEvidence?: boolean
  conflicts?: string[]
  excluded?: boolean
  confirmed: boolean
  manuallyConfirmed?: boolean
  candidates: Candidate[]
  reason: string
}
export interface RecognitionResult { grid: Grid; cells: RecognitionCell[] }

export function analyze(img: RgbImage, grid: Grid, row: number, col: number) {
  const bg = cellBackground(img, grid, row, col)
  const palette = MODEL.palette
  const distances = Object.values(palette).map((color) => bg ? colorDistance(bg, color) : 999)
  const nearest = distances.indexOf(Math.min(...distances))
  let lockedSamples = 0
  for (const y of [0.2, 0.4, 0.6, 0.8]) for (const x of [0.2, 0.4, 0.6, 0.8]) {
    const px = Math.round(grid.ox + (col + x) * grid.pw), py = Math.round(grid.oy + (row + y) * grid.ph)
    if (inBounds(img, px, py) && colorDistance(img.px(px, py), palette.locked) < 30) lockedSamples++
  }
  const kind: CellKind = nearest === 5 && distances[5] < 35 ? 'empty' : nearest === 6 && distances[6] < 35 && lockedSamples >= 10 ? 'locked' : 'unknown'
  const badge = darkRatio(img, grid, row, col, GEO.badgeBox)
  const scores = badge > TH.anchorCandidate ? [...ELEMENT_GLYPHS].map(([name, template]) => ({
    name, score: bestCorrelation(img, grid, row, col, GEO.elementBox, template, [-0.06, -0.05, -0.04, -0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06]),
  })).sort((a, b) => b.score - a.score) : []
  const top = scores[0]
  const margin = top ? top.score - scores[1].score : 0
  const anchor = !!top && top.score >= 0.60 && margin >= 0.035
  const element = anchor && top.score >= 0.68 ? Number(Object.keys(ELEMENT_NAME).find((id) => ELEMENT_NAME[+id as keyof typeof ELEMENT_NAME] === top.name)) : null
  const quality = nearest < 5 && distances[nearest] < 40 ? nearest + 1 : null
  const strongAnchor = anchor && top.score >= 0.72 && margin >= 0.07
  // 形态标是左上角灰底白字，位于图案上方；与元素标一起能把候选缩到很小
  const formScores = anchor ? [...FORM_GLYPHS].map(([name, template]) => ({
    name, score: bestCorrelation(img, grid, row, col, GEO.formBox, template, GEO.shifts),
  })).sort((a, b) => b.score - a.score) : []
  const fTop = formScores[0]
  const formMargin = fTop && formScores[1] ? fTop.score - formScores[1].score : 1
  const form = fTop && fTop.score >= 0.58 && formMargin >= 0.06 ? FORM_ID[fTop.name] ?? null : null
  // 右下角共鸣值：角标落在"最下最右占格"的右下角，多格法宝要按占格偏移去找
  const numberAt: (NumberHit | null)[][] = []
  if (anchor) {
    for (const [dr, dc] of TAIL_OFFSETS) {
      const line = numberAt[dr] ?? (numberAt[dr] = [])
      line[dc] = row + dr > 5 || col + dc > 6 ? null : readNumber(img, grid, row + dr, col + dc)
    }
  }
  const hit = numberAt[0]?.[0] ?? null
  return { kind, anchor, strongAnchor, element, quality, distances, qualityDistances: distances.slice(0, 5), form, formScore: fTop?.score ?? 0,
    number: hit?.value ?? null, numberScore: hit?.score ?? 0, numberAt }
}

/** 跨整个形状比较原生美术采样，整体均值结合最差占格，避免单格相似掩盖其它格不符。 */
export function matchArt(img: RgbImage, grid: Grid, eq: Equip, row: number, col: number, points: number[]): number {
  const p = anchoredPiece(eq.id, row, col)!
  const shape = GAME.shapeById[eq.shapeId]
  let best = 255
  for (const scale of [0.92, 1, 1.06]) {
    for (const dx of [-0.035, 0, 0.035]) for (const dy of [-0.035, 0, 0.035]) {
      let error = 0, count = 0
      const cellErrors = new Float64Array(shape.w * shape.h)
      const cellCounts = new Uint16Array(shape.w * shape.h)
      for (let i = 0; i < points.length; i += 5) {
        const fx = (points[i] / 1000 - shape.w / 2) * scale + shape.w / 2 + dx
        const fy = (points[i + 1] / 1000 - shape.h / 2) * scale + shape.h / 2 + dy
        const x = Math.round(grid.ox + (p.c + fx) * grid.pw)
        const y = Math.round(grid.oy + (p.r + fy) * grid.ph)
        if (!inBounds(img, x, y)) continue
        const radius = Math.max(1, Math.round(grid.pw * 0.015))
        let local = 110
        for (const sy of [-radius, 0, radius]) for (const sx of [-radius, 0, radius]) {
          if (!inBounds(img, x + sx, y + sy)) continue
          const pixel = img.px(x + sx, y + sy)
          local = Math.min(local, (Math.abs(pixel[0] - points[i + 2]) + Math.abs(pixel[1] - points[i + 3]) + Math.abs(pixel[2] - points[i + 4])) / 3)
        }
        error += local
        count++
        const cell = Math.floor(points[i + 1] / 1000) * shape.w + Math.floor(points[i] / 1000)
        cellErrors[cell] += local; cellCounts[cell]++
      }
      if (count) {
        let worst = 0
        for (let i = 0; i < cellCounts.length; i++) if (cellCounts[i] >= 3) worst = Math.max(worst, cellErrors[i] / cellCounts[i])
        best = Math.min(best, error / count * 0.75 + worst * 0.25)
      }
    }
  }
  return best
}

interface NumberHit { value: number; score: number }

/** 右下角标可能落在的占格偏移（由全部形状推出，最多 3 行 2 列） */
const TAIL_OFFSETS: [number, number][] = (() => {
  const seen = new Set<string>()
  const out: [number, number][] = []
  for (const shape of Object.values(GAME.shapeById)) {
    const first = [...shape.cells].sort((a, b) => a[0] - b[0] || a[1] - b[1])[0]
    const last = [...shape.cells].sort((a, b) => b[0] - a[0] || b[1] - a[1])[0]
    const key = `${last[0] - first[0]},${last[1] - first[1]}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push([last[0] - first[0], last[1] - first[1]])
  }
  return out
})()

/** 角标位置没有明显明暗对比时不必再做字形匹配 */
function hasGlyph(img: RgbImage, grid: Grid, row: number, col: number, box: readonly number[]): boolean {
  let min = 255, max = 0
  for (let fy = box[1]; fy <= box[3]; fy += 0.06) for (let fx = box[0]; fx <= box[2]; fx += 0.06) {
    const x = Math.round(grid.ox + (col + fx) * grid.pw), y = Math.round(grid.oy + (row + fy) * grid.ph)
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue
    const p = img.px(x, y)
    const l = (p[0] + p[1] + p[2]) / 3
    if (l < min) min = l
    if (l > max) max = l
  }
  return max - min > 26
}

function readNumber(img: RgbImage, grid: Grid, row: number, col: number): NumberHit | null {
  if (!hasGlyph(img, grid, row, col, GEO.numberBox)) return null
  const scores = [...NUMBER_GLYPHS].map(([text, template]) => ({
    value: Number(text), score: bestCorrelation(img, grid, row, col, GEO.numberBox, template, GEO.shifts),
  })).sort((a, b) => b.score - a.score)
  const top = scores[0]
  if (!top || top.score < TH.numberAccept) return null
  if (top.score - (scores[1]?.score ?? 0) < TH.numberMargin) return null
  return { value: top.value, score: top.score }
}

/** 角标所在的占格相对锚点格的偏移：左上标在首格，右下标在最下最右格 */
const tailOffsets = new Map<number, [number, number]>()
function tailOffset(shapeId: number): [number, number] {
  const cached = tailOffsets.get(shapeId)
  if (cached) return cached
  const shape = GAME.shapeById[shapeId]
  const first = [...shape.cells].sort((a, b) => a[0] - b[0] || a[1] - b[1])[0]
  const last = [...shape.cells].sort((a, b) => b[0] - a[0] || b[1] - a[1])[0]
  const offset: [number, number] = [last[0] - first[0], last[1] - first[1]]
  tailOffsets.set(shapeId, offset)
  return offset
}

/** 红法宝的共鸣值只与占格数有关，觉醒不影响 */
const RED_RESONANCE: Record<number, number> = { 3: 32, 4: 56, 5: 64 }

/** 共鸣值：普通法宝每升一阶翻倍（1格16、2格24、3格32、4格40为四阶），红法宝按占格数固定 */
export function resonanceOf(equipId: number): number | null {
  const eq = GAME.equipById[equipId]
  if (!eq) return null
  const size = GAME.shapeById[eq.shapeId].cellCount
  if (eq.elderId !== undefined) return RED_RESONANCE[size] ?? null
  return 8 * (size + 1) * 2 ** (eq.tier - 4)
}

/** 单格底色、徽章与品阶证据。 */
export type CellAnalysis = ReturnType<typeof analyze>

/** 为一个锚点格排序候选，同时给出"只看图案"的排序，供判断答案是否由底色决定。 */
export function rankCandidatesWithEvidence(img: RgbImage, grid: Grid, index: number, data: CellAnalysis, strongAnchors?: boolean[], samples?: OcrSample[]): { ranked: Candidate[]; plain: Candidate[]; learned: Set<number> } {
  const row = Math.floor(index / 7), col = index % 7
  const entries: { id: number; art: number }[] = []
  const learned = new Set<number>()
  const usable = (id: number): boolean => {
    const eq = GAME.equipById[id]
    if (!eq) return false
    if (data.element && eq.element !== data.element) return false
    const occupied = occupiedCells(id, row, col)
    if (!occupied) return false
    return !(strongAnchors && occupied.some((i) => i !== index && strongAnchors[i]))
  }
  const add = (id: number, art: number, fromSample: boolean) => {
    const existing = entries.find((e) => e.id === id)
    if (!existing) {
      entries.push({ id, art })
      if (fromSample) learned.add(id)
    } else if (art < existing.art) {
      existing.art = art
      if (fromSample) learned.add(id)
    }
  }
  for (const template of library.templates) {
    if (!usable(template.id)) continue
    add(template.id, matchArt(img, grid, GAME.equipById[template.id], row, col, template.points), false)
  }
  // 学习样本与内置模板同规则竞争：同一件取更接近的那份
  for (const sample of samples ?? []) {
    if (!usable(sample.equipId)) continue
    add(sample.equipId, matchArt(img, grid, GAME.equipById[sample.equipId], row, col, sample.points), true)
  }
  const penaltyOf = (id: number) => {
    if (!data.quality) return 0
    const eq = GAME.equipById[id]
    return Math.abs(eq.quality - data.quality) * 12 + (data.qualityDistances[eq.quality - 1] ?? 999) * 0.15
  }
  const candidates: Candidate[] = entries.map((e) => ({ equipId: e.id, distance: Math.round((e.art + penaltyOf(e.id)) * 100) / 100 }))
  const plain: Candidate[] = entries.map((e) => ({ equipId: e.id, distance: Math.round(e.art * 100) / 100 }))
  // 形态与共鸣值是硬约束；读错时退回全量候选，避免把正确法宝筛成未知格
  const apply = (list: Candidate[]): Candidate[] => {
    const sorted = [...list].sort((a, b) => a.distance - b.distance)
    let out = sorted
    if (data.form) {
      const byForm = sorted.filter((c) => GAME.equipById[c.equipId].weaponForm === data.form)
      if (byForm.length && byForm[0].distance <= sorted[0].distance + 6) out = byForm
    }
    // 每个候选按自身形状的角标位置取共鸣值；读数越清晰，越优先于图案
    let tolerance = 6
    const byNumber = out.filter((c) => {
      const [dr, dc] = tailOffset(GAME.equipById[c.equipId].shapeId)
      const hit = data.numberAt?.[dr]?.[dc]
      const value = hit?.value ?? (dr === 0 && dc === 0 ? data.number : null)
      if (value === null || resonanceOf(c.equipId) !== value) return false
      if (hit) tolerance = Math.max(tolerance, 6 + (hit.score - TH.numberAccept) * 40)
      return true
    })
    if (byNumber.length && byNumber[0].distance <= out[0].distance + tolerance) out = byNumber
    return out
  }
  return { ranked: apply(candidates), plain: apply(plain), learned }
}

/** 为一个锚点格按原生图案与品阶底色排序候选；供识别流程和基准对比共用。 */
export function rankCandidates(img: RgbImage, grid: Grid, index: number, data: CellAnalysis, strongAnchors?: boolean[], samples?: OcrSample[]): Candidate[] {
  return rankCandidatesWithEvidence(img, grid, index, data, strongAnchors, samples).ranked
}

export function recognizeGrid(img: RgbImage, grid: Grid, samples: OcrSample[] = []): RecognitionResult {
  if (!validGrid(img, grid)) throw new Error('网格必须完整位于图片内，且每格至少 12 像素')
  const info = Array.from({ length: 42 }, (_, i) => analyze(img, grid, Math.floor(i / 7), i % 7))
  const cells: RecognitionCell[] = info.map((c, i) => ({ row: Math.floor(i / 7), col: i % 7, kind: c.kind,
    equipId: null, awaken: null, anchorEvidence: c.anchor, confirmed: c.kind === 'empty' || c.kind === 'locked', candidates: [], reason: '' }))
  for (let index = 0; index < cells.length; index++) {
    const data = info[index]
    if (!data.anchor) continue
    const cell = cells[index]
    const { ranked, plain, learned } = rankCandidatesWithEvidence(img, grid, index, data, info.map((i) => i.strongAnchor), samples)
    const preferred = ranked[0]
    if (!preferred || preferred.distance > 35) {
      cell.kind = 'unknown'
      cell.confirmed = false
      cell.reason = '没有可靠匹配，请手动选择'
      continue
    }
    // 同件法宝的不同阶之间以图案为准；不同法宝之间（红装特效常干扰图案）仍保留底色纠正
    const plainTop = plain[0]
    const tierOnly = !!plainTop && plainTop.equipId !== preferred.equipId
      && GAME.equipById[plainTop.equipId].name === GAME.equipById[preferred.equipId].name
    const candidates = tierOnly ? plain : ranked
    const top = tierOnly ? plainTop : preferred
    cell.candidates = candidates.slice(0, 5)
    void learned
    cell.kind = 'piece'
    cell.equipId = top.equipId
    const eq = GAME.equipById[top.equipId]
    const detected = eq.elderId === undefined ? null : detectAwaken(img, grid, occupiedCells(eq.id, cell.row, cell.col)!, GAME.awakenDb[eq.id]?.maxLevel ?? 0)
    cell.awaken = detected ?? 0
    cell.awakenDetected = detected !== null
    const second = candidates[1]
    const margin = second ? second.distance - top.distance : 100
    // 同名法宝不同阶：图案几乎一致，必须同时满足更大的领先幅度，否则标为待核对
    const sameName = !!second && GAME.equipById[second.equipId].name === eq.name
    // 答案若来自弱底色证据而非图案，不能静默确认
    const byColor = !!plainTop && plainTop.equipId !== preferred.equipId
    // 用户教过这件法宝的样子：图案对得上就直接采信，不再要求候选间隔
    const taught = learned.has(top.equipId) && top.distance < 30
    cell.confirmed = taught || (top.distance < 30 && margin >= (sameName ? 3.5 : 3) && !byColor)
    cell.reason = taught ? '按你教过的样子匹配' : byColor ? '品阶由底色区分，请核对' : cell.confirmed ? '原生图案匹配' : sameName ? '同件多阶图案接近，请核对品阶' : '图案相近或偏差较大，请核对'
  }
  for (const cell of cells.filter((c) => c.kind === 'piece')) {
    const indices = occupiedCells(cell.equipId!, cell.row, cell.col)!
    const anchorIndex = cell.row * 7 + cell.col
    for (const i of indices) if (i !== anchorIndex) {
      if (cells[i].kind === 'piece' || cells[i].kind === 'locked' || info[i].anchor) continue
      cells[i].kind = 'covered'; cells[i].equipId = null; cells[i].confirmed = true
    }
  }
  refreshConflicts(cells)
  return { grid: { ...grid }, cells }
}
