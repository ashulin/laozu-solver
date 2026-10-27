import { GAME, isPlayableEquip } from '../data'
import type { SavedPiece } from '../types'
import type { Grid } from './sampling'

/** 徽章锚点是首行第一个占格；布局原点是包围盒左上角。 */
export function anchoredPiece(equipId: number, row: number, col: number, awaken = 0): SavedPiece | null {
  const eq = GAME.equipById[equipId]
  if (!eq || !isPlayableEquip(eq)) return null
  const shape = GAME.shapeById[eq.shapeId]
  const first = [...shape.cells].sort((a, b) => a[0] - b[0] || a[1] - b[1])[0]
  return { equipId, awaken, r: row - first[0], c: col - first[1] }
}

export function occupiedCells(equipId: number, row: number, col: number): number[] | null {
  const p = anchoredPiece(equipId, row, col)
  if (!p) return null
  const cells = GAME.shapeById[GAME.equipById[equipId].shapeId].cells.map(([r, c]) => [r + p.r, c + p.c])
  if (cells.some(([r, c]) => r < 0 || r >= 6 || c < 0 || c >= 7)) return null
  return cells.map(([r, c]) => r * 7 + c)
}

export function validGrid(img: { w: number; h: number }, grid: Grid): boolean {
  return Object.values(grid).every(Number.isFinite) && grid.pw >= 12 && grid.ph >= 12
    && grid.ox >= 0 && grid.oy >= 0 && grid.ox + grid.pw * 7 <= img.w + 1 && grid.oy + grid.ph * 6 <= img.h + 1
}
