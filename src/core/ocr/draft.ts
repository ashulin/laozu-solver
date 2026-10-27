import { GAME } from '../data'
import type { ElderConfig, SavedPiece, SelectedItem } from '../types'
import { checkRedEquips, redItemsOf } from '../solver/red-rules'
import { anchoredPiece, occupiedCells } from './geometry'
import type { RecognitionCell } from './recognize'
import { refreshConflicts, spatialConflicts } from './conflicts'

export const needsReview = (c: RecognitionCell): boolean => !c.excluded && (c.kind === 'unknown' || !c.confirmed || !!c.conflicts?.length || c.kind === 'piece' && c.awaken === null)
export interface ImportOptions { skipPending?: boolean }

export function setExcluded(cells: RecognitionCell[], index: number, excluded: boolean): void {
  const cell = cells[index]
  if (!cell || cell.kind !== 'piece') return
  cell.excluded = excluded
  if (!excluded) { rebuildCoverage(cells); return }
  const others = new Set(cells.filter((c) => c.kind === 'piece' && !c.excluded && c.equipId)
    .flatMap((c) => occupiedCells(c.equipId!, c.row, c.col) ?? []))
  for (const i of occupiedCells(cell.equipId!, cell.row, cell.col) ?? []) {
    if (cells[i].kind === 'covered' && !others.has(i)) {
      cells[i].kind = 'empty'; cells[i].confirmed = true; cells[i].equipId = null
    }
  }
  refreshConflicts(cells)
}

export function rebuildCoverage(cells: RecognitionCell[]): void {
  for (const cell of cells) if (cell.kind === 'covered') {
    cell.kind = 'unknown'; cell.confirmed = false; cell.equipId = null
  }
  for (const cell of cells.filter((c) => c.kind === 'piece' && c.equipId && !c.excluded)) {
    for (const i of occupiedCells(cell.equipId!, cell.row, cell.col) ?? []) {
      const target = cells[i]
      if (target.kind === 'piece' || target.kind === 'locked' || target.kind === 'unknown' && target.anchorEvidence) continue
      target.kind = 'covered'; target.equipId = null; target.confirmed = true
    }
  }
  refreshConflicts(cells)
}

export function reviewRecognition(cells: RecognitionCell[], configs: Record<number, ElderConfig>, options: ImportOptions = {}) {
  const errors: string[] = []
  const selected = new Map<number, SelectedItem>()
  const previousLayout: SavedPiece[] = []
  const lockedCells: number[] = []
  const occupied = new Set<number>()
  if (cells.length !== 42 || cells.some((c, i) => c.row !== Math.floor(i / 7) || c.col !== i % 7)) {
    return { errors: ['识别结果必须包含完整的 6×7 网格'], data: null }
  }
  const conflicts = spatialConflicts(cells)
  const omitted = new Set<number>()
  for (const [index, cell] of cells.entries()) {
    const skip = cell.kind === 'piece' && cell.excluded || options.skipPending && (cell.kind === 'unknown' || cell.kind === 'piece' && (needsReview(cell) || conflicts.has(index)))
    if (skip) {
      for (const i of cell.equipId ? occupiedCells(cell.equipId, cell.row, cell.col) ?? [] : []) omitted.add(i)
      continue
    }
    const label = `第${cell.row + 1}行第${cell.col + 1}列`
    if (cell.kind === 'unknown' || !cell.confirmed) errors.push(`${label}待核对`)
    if (!options.skipPending && conflicts.has(index)) errors.push(`${label}：${conflicts.get(index)!.join('；')}`)
    if (cell.kind === 'locked') lockedCells.push(cell.row * 7 + cell.col)
    if (cell.kind !== 'piece') continue
    const eq = cell.equipId ? GAME.equipById[cell.equipId] : null
    const indices = eq ? occupiedCells(eq.id, cell.row, cell.col) : null
    if (!eq || !indices) { errors.push(`${label}法宝无效或超出背包`); continue }
    if (indices.some((i) => occupied.has(i))) errors.push(`${label}法宝占格重叠`)
    for (const i of indices) occupied.add(i)
    const awaken = eq.elderId === undefined ? 0 : cell.awaken
    const max = GAME.awakenDb[eq.id]?.maxLevel ?? 0
    if (awaken === null || !Number.isInteger(awaken) || awaken < 0 || awaken > max) {
      errors.push(`${label}「${eq.name}」觉醒待确认（0～${max}）`)
      continue
    }
    const item = selected.get(eq.id) ?? { equipId: eq.id, copies: [] }
    item.copies.push({ awaken })
    selected.set(eq.id, item)
    previousLayout.push(anchoredPiece(eq.id, cell.row, cell.col, awaken)!)
  }
  if (lockedCells.some((i) => occupied.has(i))) errors.push('法宝与未开放格重叠')
  if (cells.some((c, i) => c.kind === 'covered' && !occupied.has(i) && !omitted.has(i))) errors.push('存在无归属的占用格，请重新核对')
  const items = [...selected.values()]
  errors.push(...checkRedEquips(redItemsOf(items), configs, GAME))
  return { errors, data: errors.length ? null : { selected: items, lockedCells, previousLayout } }
}
