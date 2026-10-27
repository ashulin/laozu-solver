import { GAME } from '../data'
import { needsReview } from './draft'
import { occupiedCells } from './geometry'
import type { RecognitionCell } from './recognize'

export type ReviewFilter = 'all' | 'pending' | 'conflict' | 'ready' | 'excluded'
export type ReviewStatus = 'auto' | 'checked' | 'pending' | 'conflict' | 'excluded' | 'unknown' | 'empty' | 'locked'
export interface ReviewFootprint { index: number; cells: number[]; status: ReviewStatus; source: RecognitionCell }

export function reviewStatus(cell: RecognitionCell, skipPending = false): ReviewStatus {
  if (cell.excluded || skipPending && needsReview(cell) && (cell.kind === 'piece' || cell.kind === 'unknown')) return 'excluded'
  if (cell.conflicts?.length) return 'conflict'
  if (cell.kind === 'unknown') return 'unknown'
  if (needsReview(cell)) return 'pending'
  if (cell.kind === 'empty' || cell.kind === 'locked') return cell.kind
  return cell.manuallyConfirmed ? 'checked' : 'auto'
}

export function reviewFootprints(cells: RecognitionCell[], skipPending = false): ReviewFootprint[] {
  return cells.flatMap((source, index) => {
    if (source.kind === 'covered') return []
    const occupied = source.kind === 'piece' && source.equipId && GAME.equipById[source.equipId]
      ? occupiedCells(source.equipId, source.row, source.col) : null
    return [{ index, cells: occupied ?? [index], status: reviewStatus(source, skipPending), source }]
  })
}

/** 删除痕迹可恢复，也允许在已经释放的格子上补录新法宝。 */
export function reviewTargets(footprints: ReviewFootprint[], index: number): number[] {
  const candidates = footprints.filter((p) => p.cells.includes(index)
    && (p.source.kind === 'piece' || p.source.kind === 'unknown' || p.source.kind === 'locked'))
  const local = footprints.find((p) => p.index === index)
  if (local && !candidates.includes(local) && candidates.every((p) => p.status === 'excluded')) candidates.push(local)
  return candidates.length ? candidates.map((p) => p.index) : local ? [local.index] : []
}

export function matchesReviewFilter(cell: RecognitionCell, filter: ReviewFilter, skipPending = false): boolean {
  const status = reviewStatus(cell, skipPending)
  if (filter === 'all') return true
  if (filter === 'excluded') return status === 'excluded'
  if (filter === 'conflict') return status === 'conflict'
  if (filter === 'pending') return status !== 'excluded' && needsReview(cell)
  return status !== 'excluded' && !needsReview(cell)
}

export const REVIEW_STATUS_NAME: Record<ReviewStatus, string> = {
  auto: '高置信度', checked: '已人工核对', pending: '待核对', conflict: '占格冲突', excluded: '不导入', unknown: '未识别', empty: '空格', locked: '未开放',
}
