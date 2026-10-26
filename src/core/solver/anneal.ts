/**
 * 单线退火（移植自觉醒版 solver-worker.js 的 runRound / runSingleLine）。
 *
 * 时钟通过 now() 注入：生产环境传 performance.now；测试注入假时钟后，
 * 本实现与觉醒版对 now() 的调用序列完全一致，结果可逐位对拍。
 */
import type { Instance, ScoringData, Snapshot, SolverContext } from '../types'
import { FILL_BONUS } from './constants'
import { makeOperators, pickOp } from './operators'
import { buildPlacementTable, greedyPlaceAll, newSolverState, snapshot, stateScore } from './placement'
import { mulberry32 } from './rng'

export const ROUND_MS = 15000
const BATCH_MS = 23
const MIN_ROUND_MS = 500

export interface AnnealProgress {
  iters: number
  bestScore: number // 搜索分（含 FILL_BONUS）
  round: number
  snap?: Snapshot[] // 最优分比上次上报更高时附带
}

export interface AnnealJob {
  instances: Instance[]
  ctx: SolverContext
  data: ScoringData
  budgetMs: number
  seed: number
  tempMult: number
  now: () => number
  onProgress?: (p: AnnealProgress) => void
  progressIntervalMs?: number // 默认 2000（与觉醒版一致）
}

export interface AnnealResult {
  bestScore: number
  bestSnap: Snapshot[]
  iters: number
  rounds: number
}

interface Shared {
  bestScore: number
  bestSnap: Snapshot[]
  iters: number
  lastProg: number
  lastSentScore: number
}

function runRound(job: AnnealJob, roundIdx: number, roundMs: number, shared: Shared): void {
  const { instances, ctx, data, seed, tempMult, now } = job
  const rng = mulberry32((seed + roundIdx * 104729) >>> 0)
  const table = buildPlacementTable(instances, ctx.R, ctx.C, new Set(ctx.locked))
  const st = newSolverState(instances, table, ctx, data)
  const ops = makeOperators(st, rng)
  greedyPlaceAll(st, instances.map((i) => i.uid), rng)
  st.score = stateScore(st)

  // 温度按本轮初始分（去掉填满奖励）计算
  const cells0 = st.pl.reduce((a, p) => a + p.cells.length, 0)
  const tb0 = ctx.fillAll ? st.score - cells0 * FILL_BONUS : st.score
  const T0 = Math.max(1, Math.abs(tb0) * 0.03 * tempMult)
  const T1 = Math.max(1e-9, Math.abs(tb0) * 1e-3 * tempMult)

  const t0 = now()
  const end = t0 + roundMs
  const interval = job.progressIntervalMs ?? 2000
  let iters = 0
  if (st.score > shared.bestScore) {
    shared.bestScore = st.score
    shared.bestSnap = snapshot(st)
  }

  while (now() < end) {
    const tNow = now()
    const frac = Math.min(1, (tNow - t0) / roundMs)
    const T = T0 * Math.pow(T1 / T0, frac)
    const batchUntil = now() + BATCH_MS
    while (now() < batchUntil && now() < end) {
      iters++
      const before = st.score
      const undo = pickOp(ops, rng)()
      if (!undo) continue
      st.score = stateScore(st)
      const delta = st.score - before
      if (delta >= 0 || rng() < Math.exp(delta / T)) {
        if (st.score > shared.bestScore) {
          shared.bestScore = st.score
          shared.bestSnap = snapshot(st)
        }
      } else {
        undo()
        st.score = before
      }
    }
    if (tNow - shared.lastProg > interval) {
      shared.lastProg = tNow
      const msg: AnnealProgress = { iters: shared.iters + iters, bestScore: shared.bestScore, round: roundIdx + 1 }
      if (shared.bestScore > shared.lastSentScore && shared.bestSnap.length) {
        shared.lastSentScore = shared.bestScore
        msg.snap = shared.bestSnap
      }
      job.onProgress?.(msg)
    }
  }
  shared.iters += iters
}

/** 每 15 秒开一轮全新搜索（新种子、新贪心起点、新温度曲线），全局最优跨轮保留 */
export function runSingleLine(job: AnnealJob): AnnealResult {
  const { now } = job
  const t0 = now()
  const shared: Shared = { bestScore: -Infinity, bestSnap: [], iters: 0, lastProg: 0, lastSentScore: -Infinity }
  let round = 0
  while (now() - t0 < job.budgetMs) {
    const remain = job.budgetMs - (now() - t0)
    const roundMs = Math.min(ROUND_MS, remain)
    if (roundMs < MIN_ROUND_MS) break
    runRound(job, round, roundMs, shared)
    round++
  }
  return { bestScore: shared.bestScore, bestSnap: shared.bestSnap, iters: shared.iters, rounds: round }
}
