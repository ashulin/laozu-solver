/// <reference lib="webworker" />
/** 求解 Worker：收 job → 单线退火 → 上报进度/结果。纯计算，无 DOM。 */
import { runSingleLine } from '@/core/solver/anneal'
import type { SolverJobMsg, SolverOutMsg } from './protocols'

const post = (msg: SolverOutMsg) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg)

self.onmessage = (e: MessageEvent<SolverJobMsg>) => {
  const job = e.data
  if (job.type !== 'solve') return
  try {
    const result = runSingleLine({
      instances: job.instances,
      ctx: job.ctx,
      data: job.data,
      budgetMs: job.budgetMs,
      seed: job.seed,
      tempMult: job.tempMult,
      now: () => performance.now(),
      onProgress: (p) => post({ type: 'progress', workerId: job.workerId, ...p }),
    })
    post({ type: 'done', workerId: job.workerId, ...result })
  } catch (err) {
    post({ type: 'error', workerId: job.workerId, message: err instanceof Error ? err.message : String(err) })
  }
}
