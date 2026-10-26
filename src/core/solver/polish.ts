/**
 * Worker 结束后的收尾（移植自觉醒版主线程 doSolve 末段）：
 *  1. 确定性局部精修：每件试遍所有位置取最优，最多 5 轮至收敛
 *  2. 补放：未放上的件逐个贪心尝试，最多 8 轮
 */
import type { Instance, ScoringData, Snapshot, SolverContext } from '../types'
import { buildPlacementTable, greedyPlace, newSolverState, placeInst, removeInst, restore, snapshot, stateScore } from './placement'
import { mulberry32 } from './rng'

export interface PolishResult {
  snap: Snapshot[]
  score: number // 搜索分
  lsRounds: number
  filledMore: boolean
}

export function polish(
  instances: Instance[], ctx: SolverContext, data: ScoringData,
  bestSnap: Snapshot[], bestScore: number, seed: number,
): PolishResult {
  const table = buildPlacementTable(instances, ctx.R, ctx.C, new Set(ctx.locked))
  const st = newSolverState(instances, table, ctx, data)
  const rng = mulberry32((seed >>> 0) + 999)
  restore(st, bestSnap)
  st.score = bestScore
  let snap = bestSnap
  let score = bestScore

  let improved = true
  let lsRounds = 0
  while (improved && lsRounds < 5) {
    improved = false
    lsRounds++
    const order = [...st.pl]
    for (let i = order.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    for (const p of order) {
      const uid = p.inst.uid
      const curKey = p.r + ',' + p.c
      const placements = st.table.table.get(uid)!
      let bestPm = null
      let bestSc = st.score
      if (!removeInst(st, uid)) continue
      for (const pm of placements) {
        if (placeInst(st, uid, pm)) {
          st.score = stateScore(st)
          if (st.score > bestSc) {
            bestSc = st.score
            bestPm = pm
          }
          removeInst(st, uid)
        }
      }
      if (bestPm) {
        placeInst(st, uid, bestPm)
        st.score = bestSc
        if (bestSc > score) {
          score = bestSc
          snap = snapshot(st)
          improved = true
        }
      } else {
        const orig = st.table.byAnchor.get(uid)!.get(curKey)
        if (orig) {
          placeInst(st, uid, orig)
          st.score = stateScore(st)
        }
      }
    }
  }

  let filledMore = false
  for (let round = 0; round < 8; round++) {
    let more = false
    for (const uid of [...st.unplaced]) {
      greedyPlace(st, uid, 64, rng)
      if (!st.unplaced.has(uid)) {
        st.score = stateScore(st)
        if (st.score > score) {
          score = st.score
          snap = snapshot(st)
          more = true
        }
      }
    }
    if (!more) break
    filledMore = true
  }
  return { snap, score, lsRounds, filledMore }
}
