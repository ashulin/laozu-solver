import { describe, expect, it } from 'vitest'
import { GAME, scoringData } from '@/core/data'
import { evaluate, neighborsOf, objective } from '@/core/solver/evaluate'
import { buildContext, buildInstances } from '@/core/solver/instances'
import { mulberry32 } from '@/core/solver/rng'
import type { Placement, SelectedItem, Skill } from '@/core/types'
import { loadReference } from '../reference/load'
import { mkEquip, mkGame, place } from '../helpers'

/* ---------------- 手算用例（合成数据） ---------------- */
const SELF_JIN: Skill = { id: 1, name: '金相邻攻+20%', scope: 'self', mask: 1 << 1, buffs: [{ attr: 2004, value: 2000 }], desc: '' }
const ADJ_JIN: Skill = { id: 2, name: '相邻金系增伤+2%', scope: 'adjacent', mask: 1 << 1, buffs: [{ attr: 2025, value: 200 }], desc: '' }

describe('neighborsOf', () => {
  it('4 邻接，按格判断，不含自身', () => {
    const a = mkEquip({ id: 1 })
    const { pl } = place([{ eq: a, r: 0, c: 0 }, { eq: a, r: 0, c: 1 }, { eq: a, r: 1, c: 1 }, { eq: a, r: 2, c: 2 }])
    expect(neighborsOf(pl, 6, 7).map((n) => n.sort())).toEqual([[1], [0, 2], [1], []])
  })
})

describe('evaluate 手算', () => {
  it('self 技能：每个相邻同系 +20% 攻击', () => {
    const a = mkEquip({ id: 1, element: 1, atk: 100, skills: [1] })
    const b = mkEquip({ id: 2, element: 1, atk: 50 })
    const c = mkEquip({ id: 3, element: 2, atk: 10 }) // 木，不触发
    const game = mkGame({ equips: [a, b, c], skills: [SELF_JIN] })
    const { pl, ctx } = place([{ eq: a, r: 0, c: 1 }, { eq: b, r: 0, c: 0 }, { eq: c, r: 0, c: 2 }])
    const r = evaluate(pl, ctx, scoringData(game), true)
    expect(r.pieces[0].atk).toBeCloseTo(120)
    expect(r.powerTotal).toBeCloseTo(120 * 10 + 50 * 10 + 10 * 10)
    expect(r.pieces[0].srcs).toEqual([expect.objectContaining({ t: 'self', n: 1, names: ['E2'] })])
  })

  it('adjacent 技能：给相邻金系增伤（百分比属性按 0.01 计入战力）', () => {
    const a = mkEquip({ id: 1, element: 1, skills: [2] })
    const b = mkEquip({ id: 2, element: 1 })
    const game = mkGame({ equips: [a, b], skills: [ADJ_JIN] })
    const { pl, ctx } = place([{ eq: a, r: 0, c: 0 }, { eq: b, r: 0, c: 1 }])
    const r = evaluate(pl, ctx, scoringData(game))
    expect(r.pieces[1].power).toBeCloseTo(200 * 0.01 * 10)
    expect(r.pieces[0].power).toBe(0)
  })

  it('自定义权重只影响 weightedTotal', () => {
    const a = mkEquip({ id: 1, atk: 100, hp: 1000 })
    const game = mkGame({ equips: [a] })
    const { pl, ctx } = place([{ eq: a, r: 0, c: 0 }])
    ctx.weights = { 2001: 1, 2003: 1 }
    ctx.target = 'weighted'
    const r = evaluate(pl, ctx, scoringData(game))
    expect(r.powerTotal).toBeCloseTo(100 * 10 + 1000 * 0.2)
    expect(r.weightedTotal).toBeCloseTo(100 + 1000)
    expect(objective(r, 'weighted')).toBe(r.weightedTotal)
    expect(objective(r, 'power')).toBe(r.powerTotal)
  })
})

describe('evaluate 觉醒', () => {
  const red = mkEquip({ id: 10, element: 1, form: 6, tier: 5, atk: 100, elderId: 1 })
  const jin = mkEquip({ id: 11, element: 1, form: 2, atk: 50 })
  const mu = mkEquip({ id: 12, element: 2, form: 6, atk: 50 })
  const awakenDb = {
    10: {
      maxLevel: 5,
      levels: {
        1: [{ type: 'self_per_adjacent' as const, element: 1 as const, attr: 2004, perUnit: 3000 }],
        2: [{ type: 'self_mult' as const, pct: 2000 }],
        3: [{ type: 'adjacent_buff' as const, element: 1 as const, pct: 800 }, { type: 'global_form' as const, form: 6 as const, pct: 1500 }],
        4: [{ type: 'self_mult' as const, pct: 3000 }],
        5: [{ type: 'adjacent_buff' as const, element: 1 as const, pct: 1500 }],
      },
    },
  }
  const game = mkGame({ equips: [red, jin, mu], awakenDb })
  const data = scoringData(game)
  const layout = (awaken: number) => place([{ eq: red, r: 0, c: 1, awaken }, { eq: jin, r: 0, c: 0 }, { eq: mu, r: 3, c: 3 }])

  it('觉醒 0：无任何觉醒效果', () => {
    const { pl, ctx } = layout(0)
    const r = evaluate(pl, ctx, data)
    expect(r.pieces.map((p) => p.atk)).toEqual([100, 50, 50])
  })

  it('觉醒 1：每相邻 1 件金系，自身攻击 +30%', () => {
    const { pl, ctx } = layout(1)
    expect(evaluate(pl, ctx, data).pieces[0].atk).toBeCloseTo(130)
  })

  it('觉醒 3：相邻金系 +8%（向下取整），背包内枪形态 +15%（不含自身）', () => {
    const { pl, ctx } = layout(3)
    const r = evaluate(pl, ctx, data, true)
    expect(r.pieces[1].atk).toBe(50 + Math.floor(50 * 0.08)) // 相邻金系
    expect(r.pieces[2].atk).toBe(50 + Math.floor(50 * 0.15)) // 远处的枪形态木系
    expect(r.pieces[0].atk).toBeCloseTo(130) // 自身不吃全局
    expect(r.pieces[1].srcs.map((s) => s.t)).toEqual(['awakenAdj'])
    expect(r.pieces[2].srcs.map((s) => s.t)).toEqual(['awakenGlobal'])
  })

  it('觉醒 5：相邻增益取最高档 15%，替代 8% 而非叠加', () => {
    const { pl, ctx } = layout(5)
    expect(evaluate(pl, ctx, data).pieces[1].atk).toBe(50 + Math.floor(50 * 0.15))
  })

  it('★ 同一红装两份副本觉醒不同，效果各自独立', () => {
    const { pl, ctx } = place([
      { eq: red, r: 0, c: 1, awaken: 3 }, { eq: jin, r: 0, c: 0 },
      { eq: red, r: 4, c: 1, awaken: 0 }, { eq: jin, r: 4, c: 0 },
    ])
    const r = evaluate(pl, ctx, data)
    expect(r.pieces[1].atk).toBe(54) // 挨着觉3 的副本
    expect(r.pieces[3].atk).toBe(50) // 挨着未觉醒的副本
    expect(r.pieces[0].atk).toBeCloseTo(130)
    // 未觉醒副本自身无觉醒加成；但它是枪形态，会吃到另一份觉3 副本的全局光环（只排除施加者自身这一件）
    expect(r.pieces[2].atk).toBe(100 + Math.floor(100 * 0.15))
  })
})

/* ---------------- 对拍觉醒版（真实数据，随机摆盘） ---------------- */
function randomLayout(seed: number) {
  const rng = mulberry32(seed)
  const pick = <T,>(arr: readonly T[]) => arr[(rng() * arr.length) | 0]
  const reds = GAME.elders.map((e) => GAME.equipById[e.redEquipId])
  const others = GAME.equips.filter((e) => e.tier >= 3 && e.elderId === undefined && e.quality === e.tier)
  const awakenOf: Record<number, number> = {}
  const selected: SelectedItem[] = []
  const red1 = pick(reds)
  let red2 = pick(reds)
  while (red2.id === red1.id) red2 = pick(reds) // 觉醒版按 equipId 共享觉醒，两件必须不同款才可对拍
  for (const eq of [red1, red2]) {
    const maxLv = GAME.awakenDb[eq.id]?.maxLevel ?? 0
    awakenOf[eq.id] = (rng() * (maxLv + 1)) | 0
    selected.push({ equipId: eq.id, copies: [{ awaken: awakenOf[eq.id] }, { awaken: awakenOf[eq.id] }] })
  }
  for (let i = 0; i < 12; i++) selected.push({ equipId: pick(others).id, copies: [{ awaken: 0 }] })

  const stars: Record<number, number> = {}
  const configs = Object.fromEntries(GAME.elders.map((e) => {
    stars[e.redEquipId] = (rng() * 6) | 0
    return [e.id, { elderId: e.id, owned: true, star: stars[e.redEquipId], awakenCap: 5 }]
  }))
  const instances = buildInstances(selected, GAME)
  const target = rng() < 0.5 ? 'power' as const : 'weighted' as const
  const ctx = buildContext(instances, {
    elderConfigs: configs, talents: [], target, weights: target === 'weighted' ? { 2001: 3, 2025: 20 } : null, fillAll: false, locked: [],
  }, GAME)

  // 随机不重叠摆放
  const occ = new Set<number>()
  const pl: Placement[] = []
  for (const inst of instances) {
    for (let tries = 0; tries < 40; tries++) {
      const r = (rng() * (6 - inst.shape.h + 1)) | 0
      const c = (rng() * (7 - inst.shape.w + 1)) | 0
      const cells = inst.shape.cells.map(([dr, dc]) => (r + dr) * 7 + (c + dc))
      if (cells.some((x) => occ.has(x))) continue
      cells.forEach((x) => occ.add(x))
      pl.push({ inst, eq: inst.eq, tier: inst.tier, r, c, cells })
      break
    }
  }
  return { pl, ctx, awakenOf }
}

describe('evaluate 对拍觉醒版（所有副本觉醒一致时结果必须完全相同）', () => {
  const ref = loadReference(GAME)
  const data = scoringData(GAME)

  it('200 组随机摆盘，powerTotal / weightedTotal / 每件攻防血 逐项相等', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { pl, ctx, awakenOf } = randomLayout(seed)
      const ours = evaluate(pl, ctx, data, false)
      const theirs = ref.evaluate(pl, { ...ctx, awaken: awakenOf }, false)
      expect(ours.powerTotal, `seed ${seed}`).toBe(theirs.powerTotal)
      expect(ours.weightedTotal, `seed ${seed}`).toBe(theirs.weightedTotal)
      const tp = theirs.pieces as { atk: number; def: number; hp: number }[]
      ours.pieces.forEach((p, i) => {
        expect([p.atk, p.def, p.hp]).toEqual([tp[i].atk, tp[i].def, tp[i].hp])
      })
    }
  })
})
