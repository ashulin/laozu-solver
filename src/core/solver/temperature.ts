/** Worker 数量、温度倍率、种子分配（对齐觉醒版） */

export const MAX_WORKERS = 6
export const WORKER_CHOICES = [2, 3, 4, 6] as const

/** 自适应：核数 - 1，至少 2，至多 6 */
export function autoWorkerCount(cores: number | undefined): number {
  return Math.min(Math.max((cores || 4) - 1, 2), MAX_WORKERS)
}

/** ≤3 个用 0.7/1.0/1.6；更多时在 0.5~2.5 之间几何分布，每个 Worker 温度都不同 */
export function tempMultsFor(n: number): number[] {
  if (n <= 3) return [0.7, 1.0, 1.6].slice(0, n)
  const lo = 0.5
  const hi = 2.5
  return Array.from({ length: n }, (_, i) => +(lo * Math.pow(hi / lo, i / (n - 1))).toFixed(2))
}

export function workerSeed(seed: number, workerIndex: number): number {
  return (seed >>> 0) + workerIndex * 7919 + 13
}
