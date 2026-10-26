import { afterEach, describe, expect, it, vi } from 'vitest'
import { scoringData } from '@/core/data'
import { runSingleLine } from '@/core/solver/anneal'
import { filledCells, placementsFromSnapshot } from '@/core/solver/placement'
import { MilestoneTracker } from '@/services/milestone-tracker'
import { startSolve, type LiveUpdate, type WorkerLike } from '@/services/solver-service'
import type { SolverJobMsg, SolverOutMsg } from '@/workers/protocols'
import { fakeClock } from '../reference/load'
import { assertValidLayout, realProblem } from '../problems'

const data = scoringData()

/** 在微任务里同步跑完退火的假 Worker */
class RunningWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null
  onerror: WorkerLike['onerror'] = null
  terminated = false
  jobs: SolverJobMsg[] = []
  postMessage(job: SolverJobMsg) {
    this.jobs.push(job)
    queueMicrotask(() => {
      const r = runSingleLine({ ...job, now: fakeClock(), onProgress: (p) => this.emit({ type: 'progress', workerId: job.workerId, ...p }) })
      this.emit({ type: 'done', workerId: job.workerId, ...r })
    })
  }
  emit(m: SolverOutMsg) {
    if (!this.terminated) this.onmessage?.({ data: m })
  }
  terminate() {
    this.terminated = true
  }
}

/** 由测试手动推送消息的假 Worker */
class ManualWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null
  onerror: WorkerLike['onerror'] = null
  terminated = false
  job?: SolverJobMsg
  postMessage(job: SolverJobMsg) {
    this.job = job
  }
  emit(m: SolverOutMsg) {
    this.onmessage?.({ data: m })
  }
  terminate() {
    this.terminated = true
  }
}

afterEach(() => vi.useRealTimers())

describe('startSolve', () => {
  it('多线程跑完：分配种子/温度，取最优并精修，结果合法', async () => {
    const p = realProblem(51, { pieces: 10 })
    const workers: RunningWorker[] = []
    const logs: string[] = []
    const lives: LiveUpdate[] = []
    const h = startSolve(
      { instances: p.instances, ctx: p.ctx, data, budgetSec: 3, seed: 42, threads: 3 },
      () => { const w = new RunningWorker(); workers.push(w); return w },
      { onLog: (s) => logs.push(s), onLive: (u) => lives.push(u) },
      { throttleMs: 0 },
    )
    const { result, milestones } = await h.promise
    expect(workers.map((w) => w.jobs[0].seed)).toEqual([55, 7974, 15893])
    expect(workers.map((w) => w.jobs[0].tempMult)).toEqual([0.7, 1, 1.6])
    expect(workers.every((w) => w.terminated)).toBe(true)
    expect(result).not.toBeNull()
    const pl = placementsFromSnapshot(p.instances, p.ctx, data, result!.layout)
    assertValidLayout(pl, p.ctx)
    expect(result!.filledCells).toBe(filledCells(pl))
    expect(result!.score).toBeCloseTo(result!.evaluation.powerTotal)
    expect(result!.evaluation.pieces[0].srcs).toBeDefined()
    expect(result!.stopped).toBe(false)
    expect(lives.length).toBeGreaterThan(0)
    expect(milestones.length).toBeGreaterThan(0)
    expect(milestones[milestones.length - 1].score).toBeCloseTo(result!.score)
    expect(logs[0]).toContain('开始求解')
    expect(logs[logs.length - 1]).toContain('求解完成')
  })

  it('中止：用实时最优收尾；没有任何快照时返回 null', async () => {
    const p = realProblem(52, { pieces: 6 })
    const ws: ManualWorker[] = []
    const h = startSolve({ instances: p.instances, ctx: p.ctx, data, budgetSec: 60, seed: 1, threads: 2 }, () => { const w = new ManualWorker(); ws.push(w); return w })
    const r0 = runSingleLine({ ...ws[0].job!, now: fakeClock(), budgetMs: 1000 })
    ws[0].emit({ type: 'progress', workerId: 0, iters: 100, bestScore: r0.bestScore, round: 1, snap: r0.bestSnap })
    h.stop()
    const { result } = await h.promise
    expect(result!.stopped).toBe(true)
    expect(result!.iterations).toBe(100)
    expect(ws.every((w) => w.terminated)).toBe(true)

    const h2 = startSolve({ instances: p.instances, ctx: p.ctx, data, budgetSec: 60, seed: 1, threads: 1 }, () => new ManualWorker())
    h2.stop()
    expect((await h2.promise).result).toBeNull()
  })

  it('Worker 报错：终止所有线程并拒绝', async () => {
    const p = realProblem(53)
    const ws: ManualWorker[] = []
    const h = startSolve({ instances: p.instances, ctx: p.ctx, data, budgetSec: 60, seed: 1, threads: 2 }, () => { const w = new ManualWorker(); ws.push(w); return w })
    ws[1].emit({ type: 'error', workerId: 1, message: 'boom' })
    await expect(h.promise).rejects.toThrow('boom')
    expect(ws.every((w) => w.terminated)).toBe(true)
  })

  it('实时推送节流：窗口内多次进步只推最后一次', async () => {
    vi.useFakeTimers()
    const p = realProblem(54, { pieces: 6 })
    const ws: ManualWorker[] = []
    const lives: LiveUpdate[] = []
    let t = 0
    const h = startSolve(
      { instances: p.instances, ctx: p.ctx, data, budgetSec: 60, seed: 1, threads: 1 },
      () => { const w = new ManualWorker(); ws.push(w); return w },
      { onLive: (u) => lives.push(u) },
      { throttleMs: 300, now: () => t },
    )
    const r = runSingleLine({ ...ws[0].job!, now: fakeClock(), budgetMs: 1000 })
    const snap = r.bestSnap
    ws[0].emit({ type: 'progress', workerId: 0, iters: 1, bestScore: 100, round: 1, snap })
    expect(lives).toHaveLength(1) // 首次立即推送
    t = 100
    ws[0].emit({ type: 'progress', workerId: 0, iters: 2, bestScore: 200, round: 1, snap })
    t = 200
    ws[0].emit({ type: 'progress', workerId: 0, iters: 3, bestScore: 300, round: 1, snap })
    ws[0].emit({ type: 'progress', workerId: 0, iters: 4, bestScore: 250, round: 1, snap }) // 更低，忽略
    expect(lives).toHaveLength(1)
    t = 300
    vi.advanceTimersByTime(300)
    expect(lives).toHaveLength(2)
    expect(lives[1].iterations).toBe(3)
    h.stop()
    await h.promise
  })

  it('强制填满时，未放满的中间解不推送', async () => {
    const p = realProblem(55, { pieces: 4, fillAll: true })
    const ws: ManualWorker[] = []
    const lives: LiveUpdate[] = []
    const h = startSolve(
      { instances: p.instances, ctx: p.ctx, data, budgetSec: 60, seed: 1, threads: 1 },
      () => { const w = new ManualWorker(); ws.push(w); return w },
      { onLive: (u) => lives.push(u) }, { throttleMs: 0 },
    )
    const r = runSingleLine({ ...ws[0].job!, now: fakeClock(), budgetMs: 1000 })
    ws[0].emit({ type: 'progress', workerId: 0, iters: 1, bestScore: 1, round: 1, snap: r.bestSnap.slice(0, 2) })
    expect(lives).toHaveLength(0)
    ws[0].emit({ type: 'progress', workerId: 0, iters: 2, bestScore: 2, round: 1, snap: r.bestSnap })
    expect(lives).toHaveLength(r.bestSnap.length === p.instances.length ? 1 : 0)
    h.stop()
    await h.promise
  })
})

describe('MilestoneTracker', () => {
  const m = (score: number, filledCells: number) => ({ elapsedMs: 0, score, filledCells, snap: [], workerId: 0 })

  it('首个点、占格提升、显著提分时记录；微小提升不记录', () => {
    const t = new MilestoneTracker(0.01)
    expect(t.offer(m(1000, 30))?.reason).toBe('new-best')
    expect(t.offer(m(1005, 30))).toBeNull() // +0.5% < 1%
    expect(t.offer(m(1020, 30))?.reason).toBe('new-best')
    expect(t.offer(m(900, 32))?.reason).toBe('fill-up')
    expect(t.milestones).toHaveLength(3)
  })

  it('超过上限时保留首尾', () => {
    const t = new MilestoneTracker(0, 5)
    for (let i = 1; i <= 10; i++) t.offer(m(i * 100, 30))
    const ms = t.milestones
    expect(ms).toHaveLength(5)
    expect(ms[0].score).toBe(100)
    expect(ms[4].score).toBe(1000)
  })

  it('finish 追加最终点（与最后一点相同则不重复）', () => {
    const t = new MilestoneTracker()
    t.offer(m(100, 10))
    t.finish(m(100, 10))
    expect(t.milestones).toHaveLength(1)
    t.finish(m(120, 12))
    expect(t.milestones.map((x) => x.reason)).toEqual(['new-best', 'fill-up'])
  })
})
