/** 主线程 ↔ Worker 消息协议（类型即契约） */
import type { Grid } from '@/core/ocr-types'
import type { Instance, ScoringData, Snapshot, SolverContext } from '@/core/types'

/* ---------------- solver.worker ---------------- */
export interface SolverJobMsg {
  type: 'solve'
  workerId: number
  instances: Instance[]
  ctx: SolverContext
  data: ScoringData
  budgetMs: number
  seed: number
  tempMult: number
}

export type SolverOutMsg =
  | { type: 'progress'; workerId: number; iters: number; bestScore: number; round: number; snap?: Snapshot[] }
  | { type: 'done'; workerId: number; bestScore: number; bestSnap: Snapshot[]; iters: number; rounds: number }
  | { type: 'error'; workerId: number; message: string }

/* ---------------- fit.worker（P2） ---------------- */
export interface FitJobMsg {
  type: 'fit'
  w: number
  h: number
  pixels: Uint8ClampedArray
}

export type FitOutMsg =
  | { type: 'done'; grid: Grid; score: number; anchors: number; converged: boolean }
  | { type: 'error'; message: string }
