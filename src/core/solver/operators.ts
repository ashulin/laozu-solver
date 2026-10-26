/** 退火扰动算子（移植自觉醒版，权重与行为一致）。每个算子成功时返回 undo 函数，失败返回 null。 */
import type { Rng } from './rng'
import { greedyPlace, greedyPlaceAll, placeInst, removeInst, restore, snapshot, type SolverState } from './placement'

export type Undo = () => void
export interface Operator {
  name: string
  w: number
  fn: () => Undo | null
}

function shuffleInPlace<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}

export function makeOperators(st: SolverState, rng: Rng): Operator[] {
  const T = st.table
  const anchor = (uid: number, key: string) => T.byAnchor.get(uid)!.get(key)!
  return [
    {
      name: 'move', w: 40, // 移动一件到另一合法位置
      fn: () => {
        if (!st.pl.length) return null
        const p = st.pl[(rng() * st.pl.length) | 0]
        const list = T.table.get(p.inst.uid)!
        if (list.length < 2) return null
        const curKey = p.r + ',' + p.c
        const pm = list[(rng() * list.length) | 0]
        if (pm.r + ',' + pm.c === curKey) return null
        if (!removeInst(st, p.inst.uid)) return null
        if (placeInst(st, p.inst.uid, pm)) {
          return () => {
            removeInst(st, p.inst.uid)
            placeInst(st, p.inst.uid, anchor(p.inst.uid, curKey))
          }
        }
        placeInst(st, p.inst.uid, anchor(p.inst.uid, curKey))
        return null
      },
    },
    {
      name: 'swap', w: 15, // 两件交换锚点
      fn: () => {
        if (st.pl.length < 2) return null
        const a = st.pl[(rng() * st.pl.length) | 0]
        const b = st.pl[(rng() * st.pl.length) | 0]
        if (a === b) return null
        const pa = T.byAnchor.get(a.inst.uid)!.get(b.r + ',' + b.c)
        const pb = T.byAnchor.get(b.inst.uid)!.get(a.r + ',' + a.c)
        if (!pa || !pb) return null
        const ka = a.r + ',' + a.c
        const kb = b.r + ',' + b.c
        removeInst(st, a.inst.uid)
        removeInst(st, b.inst.uid)
        if (placeInst(st, a.inst.uid, pa) && placeInst(st, b.inst.uid, pb)) {
          return () => {
            removeInst(st, a.inst.uid)
            removeInst(st, b.inst.uid)
            placeInst(st, a.inst.uid, anchor(a.inst.uid, ka))
            placeInst(st, b.inst.uid, anchor(b.inst.uid, kb))
          }
        }
        removeInst(st, a.inst.uid)
        removeInst(st, b.inst.uid)
        placeInst(st, a.inst.uid, anchor(a.inst.uid, ka))
        placeInst(st, b.inst.uid, anchor(b.inst.uid, kb))
        return null
      },
    },
    {
      name: 'replace', w: 14, // 拿下一件已放的，贪心放上一件未放的
      fn: () => {
        if (!st.pl.length || !st.unplaced.size) return null
        const p = st.pl[(rng() * st.pl.length) | 0]
        const uids = [...st.unplaced]
        const uid = uids[(rng() * uids.length) | 0]
        if (!removeInst(st, p.inst.uid)) return null
        const pm0 = anchor(p.inst.uid, p.r + ',' + p.c)
        greedyPlace(st, uid, 24, rng)
        if (!st.unplaced.has(uid)) {
          return () => {
            removeInst(st, uid)
            placeInst(st, p.inst.uid, pm0)
          }
        }
        placeInst(st, p.inst.uid, pm0)
        return null
      },
    },
    {
      name: 'add', w: 10, // 贪心放上一件未放的
      fn: () => {
        if (!st.unplaced.size) return null
        const uids = [...st.unplaced]
        const uid = uids[(rng() * uids.length) | 0]
        greedyPlace(st, uid, 24, rng)
        if (!st.unplaced.has(uid)) return () => { removeInst(st, uid) }
        return null
      },
    },
    {
      name: 'remove', w: 6, // 拿下一件（逃离局部最优）
      fn: () => {
        if (!st.pl.length) return null
        const p = st.pl[(rng() * st.pl.length) | 0]
        const pm0 = anchor(p.inst.uid, p.r + ',' + p.c)
        removeInst(st, p.inst.uid)
        return () => { placeInst(st, p.inst.uid, pm0) }
      },
    },
    {
      name: 'bigShuffle', w: 12, // LNS：拿下 6~8 件重排
      fn: () => {
        if (st.pl.length < 6) return null
        const snap = snapshot(st)
        const n = 6 + ((rng() * Math.min(3, st.pl.length - 6)) | 0)
        const idxs = new Set<number>()
        while (idxs.size < n) idxs.add((rng() * st.pl.length) | 0)
        const removed = [...idxs].map((i) => st.pl[i].inst.uid)
        for (const uid of removed) removeInst(st, uid)
        const toPlace = [...removed, ...st.unplaced]
        shuffleInPlace(toPlace, rng)
        greedyPlaceAll(st, toPlace, rng)
        return () => restore(st, snap)
      },
    },
    {
      name: 'shuffle', w: 15, // 拿下 2~4 件，与未放件一起随机顺序重放
      fn: () => {
        if (st.pl.length < 2) return null
        const snap = snapshot(st)
        const n = 2 + ((rng() * Math.min(3, st.pl.length - 1)) | 0)
        const idxs = new Set<number>()
        while (idxs.size < n) idxs.add((rng() * st.pl.length) | 0)
        const removed = [...idxs].map((i) => st.pl[i].inst.uid)
        for (const uid of removed) removeInst(st, uid)
        const toPlace = [...removed, ...st.unplaced]
        shuffleInPlace(toPlace, rng)
        greedyPlaceAll(st, toPlace, rng)
        return () => restore(st, snap)
      },
    },
  ]
}

export function pickOp(ops: Operator[], rng: Rng): Operator['fn'] {
  const total = ops.reduce((a, o) => a + o.w, 0)
  let x = rng() * total
  for (const o of ops) {
    x -= o.w
    if (x <= 0) return o.fn
  }
  return ops[0].fn
}
