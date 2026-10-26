import { describe, expect, it } from 'vitest'
import { GAME, scoringData } from '@/core/data'
import { runSingleLine, type AnnealProgress } from '@/core/solver/anneal'
import { polish } from '@/core/solver/polish'
import { buildPlacementTable, filledCells, greedyPlaceAll, newSolverState, placementsFromSnapshot, stateScore } from '@/core/solver/placement'
import { mulberry32 } from '@/core/solver/rng'
import { autoWorkerCount, tempMultsFor, workerSeed } from '@/core/solver/temperature'
import { fakeClock, loadReference } from '../reference/load'
import { assertValidLayout, realProblem } from '../problems'

const data = scoringData()

function greedyBaseline(seed: number, p: ReturnType<typeof realProblem>) {
  const st = newSolverState(p.instances, buildPlacementTable(p.instances, 6, 7, new Set(p.ctx.locked)), p.ctx, data)
  greedyPlaceAll(st, p.instances.map((i) => i.uid), mulberry32(seed))
  return stateScore(st)
}

describe('runSingleLine', () => {
  it('同种子 + 同时钟 → 结果完全一致', () => {
    const p = realProblem(11)
    const job = { instances: p.instances, ctx: p.ctx, data, budgetMs: 4000, seed: 7, tempMult: 1 }
    const a = runSingleLine({ ...job, now: fakeClock() })
    const b = runSingleLine({ ...job, now: fakeClock() })
    expect(a).toEqual(b)
    expect(a.iters).toBeGreaterThan(100)
  })

  it('不差于贪心初始解，且摆盘合法', () => {
    const p = realProblem(12, { pieces: 12 })
    const r = runSingleLine({ instances: p.instances, ctx: p.ctx, data, budgetMs: 6000, seed: 3, tempMult: 1, now: fakeClock() })
    const pl = placementsFromSnapshot(p.instances, p.ctx, data, r.bestSnap)
    assertValidLayout(pl, p.ctx)
    expect(r.bestScore).toBeGreaterThanOrEqual(greedyBaseline((3 + 0 * 104729) >>> 0, p))
  })

  it('预算超过 15 秒时分多轮独立搜索', () => {
    const p = realProblem(13, { pieces: 4 })
    const r = runSingleLine({ instances: p.instances, ctx: p.ctx, data, budgetMs: 31000, seed: 1, tempMult: 1, now: fakeClock(4) })
    expect(r.rounds).toBe(3) // 15s + 15s + 1s
  })

  it('进度回调：间隔约 2 秒，分数提升时附带快照', () => {
    const p = realProblem(14)
    const msgs: AnnealProgress[] = []
    runSingleLine({ instances: p.instances, ctx: p.ctx, data, budgetMs: 9000, seed: 5, tempMult: 1, now: fakeClock(), onProgress: (m) => msgs.push(m) })
    expect(msgs.length).toBeGreaterThanOrEqual(3)
    expect(msgs[0].snap).toBeDefined()
    for (let i = 1; i < msgs.length; i++) {
      expect(msgs[i].bestScore).toBeGreaterThanOrEqual(msgs[i - 1].bestScore)
      if (msgs[i].snap) expect(msgs[i].bestScore).toBeGreaterThan(msgs[i - 1].bestScore)
    }
  })
})

describe('runSingleLine 对拍觉醒版（假时钟下逐位一致）', () => {
  for (const [seed, fillAll] of [[21, false], [22, true], [23, false]] as const) {
    it(`问题 ${seed}${fillAll ? '（强制填满）' : ''}`, () => {
      const p = realProblem(seed, { fillAll, pieces: 11 })
      const ours: AnnealProgress[] = []
      const mine = runSingleLine({
        instances: p.instances, ctx: p.ctx, data, budgetMs: 5000, seed: 99, tempMult: 1.6,
        now: fakeClock(), onProgress: (m) => ours.push(m),
      })
      const ref = loadReference(GAME, fakeClock())
      const theirs = ref.runSingleLine({
        instances: p.instances,
        ctx: { ...p.ctx, awaken: p.awakenOf },
        budget: 5, seed: 99, tempMult: 1.6,
        skillById: GAME.skillById, awakenDb: GAME.awakenDb, attrs: GAME.attrs,
      })
      expect(mine.bestScore).toBe(theirs.bestScore)
      expect(mine.bestSnap).toEqual(JSON.parse(JSON.stringify(theirs.bestSnap)))
      expect(mine.iters).toBe(theirs.iters)
      expect(mine.rounds).toBe(theirs.rounds)
      expect(ours.map((m) => m.bestScore)).toEqual((ref.messages as AnnealProgress[]).map((m) => m.bestScore))
    })
  }
})

describe('polish', () => {
  it('不降低分数，结果合法', () => {
    const p = realProblem(31, { pieces: 12 })
    const r = runSingleLine({ instances: p.instances, ctx: p.ctx, data, budgetMs: 3000, seed: 1, tempMult: 1, now: fakeClock() })
    const out = polish(p.instances, p.ctx, data, r.bestSnap, r.bestScore, 1)
    expect(out.score).toBeGreaterThanOrEqual(r.bestScore)
    expect(out.lsRounds).toBeGreaterThanOrEqual(1)
    assertValidLayout(placementsFromSnapshot(p.instances, p.ctx, data, out.snap), p.ctx)
  })

  it('能把漏放的件补上', () => {
    const p = realProblem(32, { pieces: 6 })
    const r = runSingleLine({ instances: p.instances, ctx: p.ctx, data, budgetMs: 2000, seed: 1, tempMult: 1, now: fakeClock() })
    const partial = r.bestSnap.slice(0, -1) // 人为去掉一件
    const st = newSolverState(p.instances, buildPlacementTable(p.instances, 6, 7, new Set()), p.ctx, data)
    for (const s of partial) {
      const pm = st.table.byAnchor.get(s.uid)!.get(s.r + ',' + s.c)!
      st.pl.push({ inst: st.uidToInst.get(s.uid)!, eq: st.uidToInst.get(s.uid)!.eq, tier: st.uidToInst.get(s.uid)!.tier, r: s.r, c: s.c, cells: pm.cells })
    }
    const out = polish(p.instances, p.ctx, data, partial, stateScore(st), 1)
    expect(out.snap.length).toBe(r.bestSnap.length)
  })
})

describe('强制填满', () => {
  it('件数足够时填满全部可用格', () => {
    // 1 格小件 42 个：任何摆法都能填满
    const one = GAME.equips.find((e) => GAME.shapeById[e.shapeId].cellCount === 1 && e.tier === 4 && e.elderId === undefined)!
    const p = realProblem(41, { fillAll: true, pieces: 0, locked: [0, 6] })
    const instances = Array.from({ length: 40 }, (_, uid) => ({ uid, eq: one, tier: one.tier, shape: GAME.shapeById[one.shapeId], awaken: 0 }))
    const ctx = { ...p.ctx, effAtk: instances.map(() => 10), effDef: instances.map(() => 10), effHp: instances.map(() => 10) }
    const r = runSingleLine({ instances, ctx, data, budgetMs: 1500, seed: 1, tempMult: 1, now: fakeClock() })
    const pl = placementsFromSnapshot(instances, ctx, data, r.bestSnap)
    expect(filledCells(pl)).toBe(40)
  })
})

describe('temperature', () => {
  it('Worker 数：核数-1，夹在 2~6', () => {
    expect([1, 2, 4, 8, 14, undefined].map((c) => autoWorkerCount(c))).toEqual([2, 2, 3, 6, 6, 3])
  })
  it('温度倍率', () => {
    expect(tempMultsFor(1)).toEqual([0.7])
    expect(tempMultsFor(3)).toEqual([0.7, 1, 1.6])
    const six = tempMultsFor(6)
    expect(six[0]).toBe(0.5)
    expect(six[5]).toBe(2.5)
    expect(new Set(six).size).toBe(6)
  })
  it('种子分配与觉醒版一致', () => {
    expect([0, 1, 2].map((i) => workerSeed(42, i))).toEqual([55, 7974, 15893])
  })
})
