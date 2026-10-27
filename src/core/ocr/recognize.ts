import { GAME } from '../data'
import library from '../data/raw/ocr-library.json'
import { ELEMENT_NAME } from '../types'
import type { Equip } from '../types'
import { anchoredPiece, occupiedCells, validGrid } from './geometry'
import { detectAwaken } from './awaken'
import { refreshConflicts } from './conflicts'
import { ELEMENT_GLYPHS, GEO, MODEL, TH } from './model'
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

function analyze(img: RgbImage, grid: Grid, row: number, col: number) {
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
  return { kind, anchor, strongAnchor, element, quality, distances }
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

export function recognizeGrid(img: RgbImage, grid: Grid): RecognitionResult {
  if (!validGrid(img, grid)) throw new Error('网格必须完整位于图片内，且每格至少 12 像素')
  const info = Array.from({ length: 42 }, (_, i) => analyze(img, grid, Math.floor(i / 7), i % 7))
  const cells: RecognitionCell[] = info.map((c, i) => ({ row: Math.floor(i / 7), col: i % 7, kind: c.kind,
    equipId: null, awaken: null, anchorEvidence: c.anchor, confirmed: c.kind === 'empty' || c.kind === 'locked', candidates: [], reason: '' }))
  for (let index = 0; index < cells.length; index++) {
    const data = info[index]
    if (!data.anchor) continue
    const cell = cells[index]
    const candidates: Candidate[] = []
    for (const template of library.templates) {
      const eq = GAME.equipById[template.id]
      if (data.element && eq.element !== data.element) continue
      const occupied = occupiedCells(eq.id, cell.row, cell.col)
      if (!occupied || occupied.some((i) => i !== index && info[i].strongAnchor)) continue
      const colorPenalty = data.quality && eq.quality !== data.quality ? 8 : 0
      const distance = matchArt(img, grid, eq, cell.row, cell.col, template.points) + colorPenalty
      candidates.push({ equipId: eq.id, distance: Math.round(distance * 100) / 100 })
    }
    candidates.sort((a, b) => a.distance - b.distance)
    cell.candidates = candidates.slice(0, 5)
    const top = candidates[0]
    if (!top || top.distance > 35) { cell.kind = 'unknown'; cell.confirmed = false; cell.reason = '没有可靠匹配，请手动选择'; continue }
    cell.kind = 'piece'
    cell.equipId = top.equipId
    const eq = GAME.equipById[top.equipId]
    const detected = eq.elderId === undefined ? null : detectAwaken(img, grid, occupiedCells(eq.id, cell.row, cell.col)!, GAME.awakenDb[eq.id]?.maxLevel ?? 0)
    cell.awaken = detected ?? 0
    cell.awakenDetected = detected !== null
    const margin = candidates[1] ? candidates[1].distance - top.distance : 100
    cell.confirmed = top.distance < 30 && margin >= 3
    cell.reason = cell.confirmed ? '原生图案匹配' : '图案相近或偏差较大，请核对'
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
