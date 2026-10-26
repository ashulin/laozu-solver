/**
 * 求解编排（主线程）：Worker 池生命周期、进度聚合、实时最优节流推送、里程碑、中止、收尾精修。
 * Worker 由工厂函数创建，单测中可注入假 Worker。
 */
import { evaluate, objective } from '@/core/solver/evaluate'
import { filledCells, placementsFromSnapshot, trueScore } from '@/core/solver/placement'
import { polish } from '@/core/solver/polish'
import { tempMultsFor, workerSeed } from '@/core/solver/temperature'
import type { Instance, Milestone, ScoringData, Snapshot, SolveResult, SolverContext } from '@/core/types'
import type { SolverJobMsg, SolverOutMsg } from '@/workers/protocols'
import { MilestoneTracker } from './milestone-tracker'

export interface WorkerLike {
  postMessage(msg: SolverJobMsg): void
  terminate(): void
  onmessage: ((e: { data: SolverOutMsg }) => void) | null
  onerror: ((e: { message?: string }) => void) | null
}
export type WorkerFactory = () => WorkerLike

export interface SolveRequest {
  instances: Instance[]
  ctx: SolverContext
  data: ScoringData
  budgetSec: number
  seed: number
  threads: number
}

export interface LiveUpdate {
  elapsedMs: number
  iterations: number
  score: number // 真实分
  filledCells: number
  snap: Snapshot[]
  workerId: number
}

export interface SolveCallbacks {
  onLive?(u: LiveUpdate): void
  onMilestone?(m: Milestone): void
  onLog?(line: string): void
}

export interface SolveOutcome {
  result: SolveResult | null // null：中止时还没有任何可用摆盘
  milestones: Milestone[]
}

export interface SolveHandle {
  promise: Promise<SolveOutcome>
  stop(): void
}

export interface SolveOptions {
  now?: () => number
  throttleMs?: number
}

const fmt = (n: number) => Math.round(n).toLocaleString('zh-CN')

export function startSolve(req: SolveRequest, createWorker: WorkerFactory, cb: SolveCallbacks = {}, opts: SolveOptions = {}): SolveHandle {
  const now = opts.now ?? (() => performance.now())
  const throttleMs = opts.throttleMs ?? 300
  const t0 = now()
  const n = Math.max(1, Math.floor(req.threads))
  const temps = tempMultsFor(n)
  const { ctx } = req
  const cellsOf = new Map(req.instances.map((i) => [i.uid, i.shape.cellCount]))
  const usable = ctx.R * ctx.C - new Set(ctx.locked).size
  const filledOf = (snap: Snapshot[]) => snap.reduce((a, s) => a + (cellsOf.get(s.uid) ?? 0), 0)

  const tracker = new MilestoneTracker()
  const workers: WorkerLike[] = []
  const iters = new Array<number>(n).fill(0)
  const done: (Extract<SolverOutMsg, { type: 'done' }> | undefined)[] = new Array(n)
  let doneCount = 0
  let live: { score: number; snap: Snapshot[]; workerId: number } | null = null
  let lastEmit = -Infinity
  let pending: LiveUpdate | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let settled = false

  let resolve!: (v: SolveOutcome) => void
  let reject!: (e: Error) => void
  const promise = new Promise<SolveOutcome>((res, rej) => {
    resolve = res
    reject = rej
  })

  const log = (s: string) => cb.onLog?.(s)
  const totalIters = () => iters.reduce((a, b) => a + b, 0)

  const flush = () => {
    timer = null
    if (pending && !settled) {
      lastEmit = now()
      cb.onLive?.(pending)
      pending = null
    }
  }
  const pushLive = (u: LiveUpdate) => {
    pending = u
    const wait = throttleMs - (now() - lastEmit)
    if (wait <= 0) flush()
    else if (!timer) timer = setTimeout(flush, wait)
  }

  const killAll = () => {
    for (const w of workers) {
      try {
        w.terminate()
      } catch {
        /* 忽略 */
      }
    }
    if (timer) clearTimeout(timer)
    timer = null
  }

  const finalize = (best: { score: number; snap: Snapshot[]; workerId: number } | null, stopped: boolean) => {
    if (settled) return
    settled = true
    killAll()
    if (!best || !best.snap.length) {
      log('已中止，还没有可用的摆盘。')
      resolve({ result: null, milestones: tracker.milestones })
      return
    }
    const pol = polish(req.instances, ctx, req.data, best.snap, best.score, req.seed)
    const pl = placementsFromSnapshot(req.instances, ctx, req.data, pol.snap)
    const evaluation = evaluate(pl, ctx, req.data, true)
    const score = objective(evaluation, ctx.target)
    const filled = filledCells(pl)
    const elapsedMs = now() - t0
    tracker.finish({ elapsedMs, score, filledCells: filled, snap: pol.snap, workerId: best.workerId })
    if (pol.lsRounds > 1) log(`局部精修 ${pol.lsRounds} 轮${pol.filledMore ? '，并补放了漏掉的件' : ''}`)
    const unplaced = req.instances.length - pl.length
    log(`${stopped ? '已中止，采用当前最优' : '求解完成'}：总分 ${fmt(score)}，放置 ${pl.length}/${req.instances.length} 件${unplaced ? `（${unplaced} 件放不下或不划算）` : ''}，占格 ${filled}/${usable}，累计迭代 ${fmt(totalIters())} 次`)
    resolve({
      result: {
        score, evaluation, layout: pol.snap, placedCount: pl.length, instanceCount: req.instances.length,
        filledCells: filled, usableCells: usable, iterations: totalIters(), elapsedMs, seed: req.seed, stopped,
      },
      milestones: tracker.milestones,
    })
  }

  const fail = (msg: string) => {
    if (settled) return
    settled = true
    killAll()
    log(`求解失败：${msg}`)
    reject(new Error(msg))
  }

  const onMessage = (msg: SolverOutMsg) => {
    if (settled) return
    if (msg.type === 'progress') {
      iters[msg.workerId] = msg.iters
      if (msg.snap && msg.snap.length && (!live || msg.bestScore > live.score)) {
        live = { score: msg.bestScore, snap: msg.snap, workerId: msg.workerId }
        const filled = filledOf(msg.snap)
        const score = trueScore(msg.bestScore, filled, ctx.fillAll)
        const elapsedMs = now() - t0
        const ms = tracker.offer({ elapsedMs, score, filledCells: filled, snap: msg.snap, workerId: msg.workerId })
        if (ms) {
          cb.onMilestone?.(ms)
          log(`[${(elapsedMs / 1000).toFixed(1)}s] ${ms.reason === 'fill-up' ? '占格提升' : '新最优'}（线程 ${msg.workerId + 1}）：总分 ${fmt(score)}，占格 ${filled}/${usable}`)
        }
        // 强制填满时，未放满的中间解不展示（仍保留用于中止兜底）
        const showable = !ctx.fillAll || msg.snap.length === req.instances.length || filled === usable
        if (showable) pushLive({ elapsedMs, iterations: totalIters(), score, filledCells: filled, snap: msg.snap, workerId: msg.workerId })
      }
    } else if (msg.type === 'done') {
      iters[msg.workerId] = msg.iters
      done[msg.workerId] = msg
      doneCount++
      log(`线程 ${msg.workerId + 1} 完成：${fmt(msg.iters)} 次迭代，${msg.rounds} 轮`)
      if (doneCount === n) {
        let best = done[0]!
        for (const d of done) if (d && d.bestScore > best.bestScore) best = d
        finalize({ score: best.bestScore, snap: best.bestSnap, workerId: best.workerId }, false)
      }
    } else if (msg.type === 'error') {
      fail(`线程 ${msg.workerId + 1} 出错：${msg.message}`)
    }
  }

  log(`开始求解：${req.instances.length} 件，可用 ${usable} 格，预算 ${req.budgetSec} 秒，${n} 线程，温度倍率 [${temps.join(', ')}]，种子 ${req.seed}`)
  for (let wi = 0; wi < n; wi++) {
    let w: WorkerLike
    try {
      w = createWorker()
    } catch (e) {
      fail(`无法创建 Worker：${e instanceof Error ? e.message : String(e)}`)
      break
    }
    workers.push(w)
    w.onmessage = (e) => onMessage(e.data)
    w.onerror = (e) => fail(`线程 ${wi + 1} 加载失败：${e?.message ?? '未知错误'}`)
    w.postMessage({
      type: 'solve', workerId: wi, instances: req.instances, ctx, data: req.data,
      budgetMs: req.budgetSec * 1000, seed: workerSeed(req.seed, wi), tempMult: temps[wi],
    })
  }

  return {
    promise,
    stop: () => finalize(live, true),
  }
}

/** 生产环境的 Worker 工厂（Vite 会把 worker 打成独立 chunk） */
export function browserWorkerFactory(): WorkerLike {
  return new Worker(new URL('../workers/solver.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike
}
