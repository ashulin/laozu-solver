import { describe, expect, it } from 'vitest'
import { scoringData } from '@/core/data'
import { makeOperators } from '@/core/solver/operators'
import {
  buildPlacementTable, greedyPlaceAll, newSolverState, placementsFromSnapshot, restore, snapshot, stateScore, trueScore,
} from '@/core/solver/placement'
import { mulberry32 } from '@/core/solver/rng'
import { FILL_BONUS } from '@/core/solver/constants'
import { assertValidLayout, realProblem } from '../problems'

const data = scoringData()

describe('buildPlacementTable', () => {
  it('列出所有不越界、不压锁格的锚点', () => {
    const { instances, ctx } = realProblem(1)
    const inst = instances[0]
    const locked = new Set([0, 1, 2, 3, 4, 5, 6]) // 第一行全锁
    const t = buildPlacementTable([inst], 6, 7, locked)
    const list = t.table.get(inst.uid)!
    const expected = (6 - inst.shape.h + 1) * (7 - inst.shape.w + 1)
    expect(list.length).toBeLessThan(expected)
    for (const pm of list) expect(pm.cells.some((c) => locked.has(c))).toBe(false)
    expect(t.byAnchor.get(inst.uid)!.size).toBe(list.length)
    expect(ctx.R).toBe(6)
  })
})

describe('snapshot / restore', () => {
  it('往返一致', () => {
    const { instances, ctx } = realProblem(2)
    const st = newSolverState(instances, buildPlacementTable(instances, 6, 7, new Set()), ctx, data)
    greedyPlaceAll(st, instances.map((i) => i.uid), mulberry32(1))
    const snap = snapshot(st)
    const score = stateScore(st)
    restore(st, [])
    expect(st.pl).toHaveLength(0)
    expect(st.unplaced.size).toBe(instances.length)
    restore(st, snap)
    expect(snapshot(st)).toEqual(snap)
    expect(stateScore(st)).toBe(score)
    assertValidLayout(st.pl, ctx)
  })

  it('placementsFromSnapshot 还原的摆放合法', () => {
    const { instances, ctx } = realProblem(3)
    const st = newSolverState(instances, buildPlacementTable(instances, 6, 7, new Set()), ctx, data)
    greedyPlaceAll(st, instances.map((i) => i.uid), mulberry32(2))
    const pl = placementsFromSnapshot(instances, ctx, data, snapshot(st))
    expect(pl.map((p) => p.inst.uid)).toEqual(st.pl.map((p) => p.inst.uid))
    assertValidLayout(pl, ctx)
  })
})

describe('stateScore / trueScore', () => {
  it('强制填满时每格加 FILL_BONUS，trueScore 能还原', () => {
    const { instances, ctx } = realProblem(4, { fillAll: true })
    const st = newSolverState(instances, buildPlacementTable(instances, 6, 7, new Set()), ctx, data)
    greedyPlaceAll(st, instances.map((i) => i.uid), mulberry32(3))
    const cells = st.pl.reduce((a, p) => a + p.cells.length, 0)
    const s = stateScore(st)
    expect(s).toBeGreaterThan(cells * FILL_BONUS)
    const noFill = { ...st, ctx: { ...ctx, fillAll: false } }
    expect(trueScore(s, cells, true)).toBeCloseTo(stateScore(noFill), 3)
  })
})

describe('算子', () => {
  it('每个算子的 undo 都能把状态与分数恢复原样（随机 2000 次）', () => {
    const { instances, ctx } = realProblem(5, { pieces: 14, locked: [6, 13] })
    const st = newSolverState(instances, buildPlacementTable(instances, 6, 7, new Set(ctx.locked)), ctx, data)
    const rng = mulberry32(42)
    greedyPlaceAll(st, instances.map((i) => i.uid), rng)
    const ops = makeOperators(st, rng)
    expect(ops.map((o) => [o.name, o.w])).toEqual([
      ['move', 40], ['swap', 15], ['replace', 14], ['add', 10], ['remove', 6], ['bigShuffle', 12], ['shuffle', 15],
    ])
    for (let i = 0; i < 2000; i++) {
      const op = ops[(rng() * ops.length) | 0]
      const before = JSON.stringify(snapshot(st).slice().sort((a, b) => a.uid - b.uid))
      const scoreBefore = stateScore(st)
      const undo = op.fn()
      assertValidLayout(st.pl, ctx)
      if (undo) {
        undo()
        const after = JSON.stringify(snapshot(st).slice().sort((a, b) => a.uid - b.uid))
        expect(after, `${op.name} 第 ${i} 次`).toBe(before)
        expect(stateScore(st)).toBe(scoreBefore)
      } else {
        // 失败的算子不改变状态
        expect(JSON.stringify(snapshot(st).slice().sort((a, b) => a.uid - b.uid)), `${op.name} 失败后`).toBe(before)
      }
      // 偶尔真的接受一次，让状态继续演化
      if (rng() < 0.3) op.fn()
      assertValidLayout(st.pl, ctx)
    }
  })
})
