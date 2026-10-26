import type { Milestone, Snapshot } from '@/core/types'

/**
 * 里程碑记录（供回放）：
 *  - 占格数增加 → 记录（fill-up）
 *  - 分数比上一个里程碑提升超过 minGain 比例 → 记录（new-best）
 * 超过 maxCount 时丢弃中间较早的点，保留首尾。
 */
export class MilestoneTracker {
  private list: Milestone[] = []

  constructor(private readonly minGain = 0.003, private readonly maxCount = 60) {}

  offer(m: { elapsedMs: number; score: number; filledCells: number; snap: Snapshot[]; workerId: number }): Milestone | null {
    const last = this.list[this.list.length - 1]
    let reason: Milestone['reason'] | null = null
    if (!last) reason = 'new-best'
    else if (m.filledCells > last.filledCells) reason = 'fill-up'
    else if (m.score > last.score && (m.score - last.score) > Math.abs(last.score) * this.minGain) reason = 'new-best'
    if (!reason) return null
    const ms: Milestone = { ...m, reason }
    this.list.push(ms)
    if (this.list.length > this.maxCount) this.list.splice(1, 1)
    return ms
  }

  /** 求解结束时把最终结果作为最后一个点 */
  finish(m: { elapsedMs: number; score: number; filledCells: number; snap: Snapshot[]; workerId: number }): void {
    const last = this.list[this.list.length - 1]
    if (last && last.score === m.score && last.filledCells === m.filledCells) return
    this.list.push({ ...m, reason: last && m.filledCells > last.filledCells ? 'fill-up' : 'new-best' })
  }

  get milestones(): Milestone[] {
    return [...this.list]
  }
}
