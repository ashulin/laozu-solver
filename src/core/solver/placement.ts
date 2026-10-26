/**
 * 摆放表与求解状态（移植自觉醒版 solver-worker.js，逻辑与调用顺序保持一致以便对拍）。
 * 法宝方向锁死，不旋转。
 */
import type { Instance, Placement, ScoringData, Snapshot, SolverContext } from '../types'
import { FILL_BONUS } from './constants'
import { evaluate, objective } from './evaluate'
import type { Rng } from './rng'

export interface Pm {
  r: number
  c: number
  cells: number[]
}

export interface PlacementTable {
  table: Map<number, Pm[]> // uid → 所有合法摆放
  byAnchor: Map<number, Map<string, Pm>> // uid → "r,c" → 摆放
}

export interface SolverState {
  instances: Instance[]
  table: PlacementTable
  R: number
  C: number
  locked: Set<number>
  ctx: SolverContext
  data: ScoringData
  pl: Placement[]
  unplaced: Set<number>
  uidToInst: Map<number, Instance>
  score: number
}

export function buildPlacementTable(instances: Instance[], R: number, C: number, locked: Set<number>): PlacementTable {
  const table = new Map<number, Pm[]>()
  const byAnchor = new Map<number, Map<string, Pm>>()
  for (const inst of instances) {
    const list: Pm[] = []
    const am = new Map<string, Pm>()
    const sh = inst.shape
    for (let r = 0; r + sh.h <= R; r++) {
      for (let c = 0; c + sh.w <= C; c++) {
        const cells = sh.cells.map(([dr, dc]) => (r + dr) * C + (c + dc))
        if (cells.some((i) => locked.has(i))) continue
        const pm = { r, c, cells }
        list.push(pm)
        am.set(r + ',' + c, pm)
      }
    }
    table.set(inst.uid, list)
    byAnchor.set(inst.uid, am)
  }
  return { table, byAnchor }
}

export function newSolverState(instances: Instance[], table: PlacementTable, ctx: SolverContext, data: ScoringData): SolverState {
  return {
    instances,
    table,
    R: ctx.R,
    C: ctx.C,
    locked: new Set(ctx.locked),
    ctx,
    data,
    pl: [],
    unplaced: new Set(instances.map((i) => i.uid)),
    uidToInst: new Map(instances.map((i) => [i.uid, i])),
    score: -Infinity,
  }
}

export function filledCells(pl: Placement[]): number {
  return pl.reduce((a, p) => a + p.cells.length, 0)
}

/** 搜索用分数：目标分 + 强制填满时每格 FILL_BONUS */
export function stateScore(st: SolverState): number {
  if (!st.pl.length) return 0
  const r = evaluate(st.pl, st.ctx, st.data, false)
  const base = objective(r, st.ctx.target)
  return base + (st.ctx.fillAll ? filledCells(st.pl) * FILL_BONUS : 0)
}

/** 搜索分 → 真实分（去掉 FILL_BONUS） */
export function trueScore(searchScore: number, filled: number, fillAll: boolean): number {
  return fillAll ? searchScore - filled * FILL_BONUS : searchScore
}

function buildOcc(pl: Placement[], R: number, C: number, locked: Set<number>): Int16Array {
  const occ = new Int16Array(R * C).fill(-1)
  for (const i of locked) occ[i] = -2
  pl.forEach((p, pi) => {
    for (const c of p.cells) occ[c] = pi
  })
  return occ
}

function cellsFree(cells: number[], occ: Int16Array): boolean {
  for (const i of cells) if (occ[i] !== -1) return false
  return true
}

export function placeInst(st: SolverState, uid: number, pm: Pm): boolean {
  const inst = st.uidToInst.get(uid)!
  const occ = buildOcc(st.pl, st.R, st.C, st.locked)
  if (!cellsFree(pm.cells, occ)) return false
  st.pl.push({ inst, eq: inst.eq, tier: inst.tier, r: pm.r, c: pm.c, cells: pm.cells })
  st.unplaced.delete(uid)
  return true
}

export function removeInst(st: SolverState, uid: number): Placement | null {
  const idx = st.pl.findIndex((p) => p.inst.uid === uid)
  if (idx < 0) return null
  const [p] = st.pl.splice(idx, 1)
  st.unplaced.add(uid)
  return p
}

export function snapshot(st: SolverState): Snapshot[] {
  return st.pl.map((p) => ({ uid: p.inst.uid, r: p.r, c: p.c }))
}

export function restore(st: SolverState, snap: Snapshot[]): void {
  st.pl = []
  st.unplaced = new Set(st.instances.map((i) => i.uid))
  for (const s of snap) {
    const pm = st.table.byAnchor.get(s.uid)?.get(s.r + ',' + s.c)
    if (pm) placeInst(st, s.uid, pm)
  }
}

/** 贪心：为 uid 在（最多 maxSamples 个采样）位置中选边际增益最大的摆放 */
export function greedyPlace(st: SolverState, uid: number, maxSamples: number, rng: Rng): number {
  const list = st.table.table.get(uid)
  if (!list || !list.length) return 0
  const occ = buildOcc(st.pl, st.R, st.C, st.locked)
  const base = stateScore(st)
  const n = list.length
  const step = n > maxSamples ? Math.ceil(n / maxSamples) : 1
  const start = step > 1 ? (rng() * step) | 0 : 0
  let bestPm: Pm | null = null
  let bestGain = -Infinity
  for (let i = start; i < n; i += step) {
    const pm = list[i]
    if (!cellsFree(pm.cells, occ)) continue
    const inst = st.uidToInst.get(uid)!
    st.pl.push({ inst, eq: inst.eq, tier: inst.tier, r: pm.r, c: pm.c, cells: pm.cells })
    const sc = stateScore(st)
    st.pl.pop()
    const gain = sc - base
    if (gain > bestGain || (gain === bestGain && rng() < 0.3)) {
      bestGain = gain
      bestPm = pm
    }
  }
  if (bestPm && placeInst(st, uid, bestPm)) return bestGain
  return 0
}

export function greedyPlaceAll(st: SolverState, uids: number[], rng: Rng): void {
  for (const uid of uids) {
    if (!st.unplaced.has(uid)) continue
    greedyPlace(st, uid, 64, rng)
  }
}

/** 把快照还原成 Placement[]（用于实时显示、收藏摆盘计分） */
export function placementsFromSnapshot(instances: Instance[], ctx: SolverContext, data: ScoringData, snap: Snapshot[]): Placement[] {
  const table = buildPlacementTable(instances, ctx.R, ctx.C, new Set(ctx.locked))
  const st = newSolverState(instances, table, ctx, data)
  restore(st, snap)
  return st.pl
}
