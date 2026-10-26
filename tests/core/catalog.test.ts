import { describe, expect, it } from 'vitest'
import { GAME } from '@/core/data'
import { describeAwakenEffect, describeAwakenLevels } from '@/core/awaken-text'
import { bagElements, buildCatalog, compareSelected, defaultTierOf, facetCounts, filterCatalog } from '@/core/catalog'
import { scoreLayout, toSavedPieces } from '@/core/solver/layout-score'
import { evaluate } from '@/core/solver/evaluate'
import { buildContext, buildInstances } from '@/core/solver/instances'
import { scoringData } from '@/core/data'
import type { CatalogFilters } from '@/core/types'

const catalog = buildCatalog(GAME)
const F = (p: Partial<CatalogFilters> = {}): CatalogFilters => ({ elements: [], forms: [], cellCounts: [], tiers: [], keyword: '', ...p })

describe('buildCatalog', () => {
  it('按名称聚合，排除占位法宝，各阶升序', () => {
    expect(catalog.find((e) => e.name === '灵肘')).toBeUndefined()
    const yjj = catalog.find((e) => e.name === '蕴金戒')!
    expect(yjj.tiers.map((t) => t.tier)).toEqual([1, 2, 3, 4])
    expect(new Set(catalog.map((e) => e.name)).size).toBe(catalog.length)
  })

  it('同名各阶形状一致（占格数筛选按条目判断成立）', () => {
    for (const e of catalog) for (const t of e.tiers) expect(t.shapeId, e.name).toBe(e.tiers[0].shapeId)
  })

  it('80 件红装都带长老', () => {
    expect(catalog.filter((e) => e.elder)).toHaveLength(80)
  })

  it('普通法宝在前、红装在后；各段内按占格数从小到大，同格数按元素', () => {
    const firstRed = catalog.findIndex((e) => e.elder)
    expect(catalog.slice(0, firstRed).every((e) => !e.elder)).toBe(true)
    expect(catalog.slice(firstRed).every((e) => e.elder)).toBe(true)
    for (const seg of [catalog.slice(0, firstRed), catalog.slice(firstRed)]) {
      for (let i = 1; i < seg.length; i++) {
        const a = seg[i - 1]
        const b = seg[i]
        expect(a.cellCount < b.cellCount || (a.cellCount === b.cellCount && a.element <= b.element), `${a.name} → ${b.name}`).toBe(true)
      }
    }
    expect(catalog[0].cellCount).toBe(1)
    expect(catalog[firstRed].cellCount).toBe(3) // 红装最小 3 格
  })

  it('筛选后仍保持「普通在前、红装在后，段内占格升序」', () => {
    const r = filterCatalog(catalog, F({ elements: [4] }))
    const key = (e: (typeof r)[number]) => (e.elder ? 100 : 0) + e.cellCount
    expect(r.map(key)).toEqual([...r.map(key)].sort((a, b) => a - b))
  })
})

describe('bagElements / compareSelected', () => {
  const eqOf = (cells: number, element: number, tier = 4) => GAME.equips.find((e) => GAME.shapeById[e.shapeId].cellCount === cells && e.element === element && e.quality < 5 && e.tier === tier)!
  const redOf = (cells: number, skip = 0) => GAME.equips.filter((e) => e.elderId !== undefined && GAME.shapeById[e.shapeId].cellCount === cells)[skip]
  const cellsOf = (e: { shapeId: number }) => GAME.shapeById[e.shapeId].cellCount

  it('无已选 → 空（即全部元素）；同元素去重；两种元素升序', () => {
    expect(bagElements(GAME, [])).toEqual([])
    expect(bagElements(GAME, [eqOf(1, 3).id, eqOf(2, 3).id])).toEqual([3])
    expect(bagElements(GAME, [eqOf(2, 4).id, eqOf(1, 1).id, eqOf(3, 4).id])).toEqual([1, 4])
  })

  it('普通法宝：占格数升序，同格数按品阶低到高', () => {
    const list = [eqOf(4, 1, 4), eqOf(1, 4, 3), eqOf(2, 2, 4), eqOf(1, 1, 4), eqOf(1, 2, 1)].map((eq) => ({ eq, awaken: 0 }))
    const sorted = [...list].sort((a, b) => compareSelected(GAME, a, b))
    expect(sorted.map((r) => [cellsOf(r.eq), r.eq.tier])).toEqual([[1, 1], [1, 3], [1, 4], [2, 4], [4, 4]])
  })

  it('红装排在全部普通法宝之后：占格数升序，同格数按觉醒未觉醒到已觉醒', () => {
    const r4a = { eq: redOf(4, 0), awaken: 2 }
    const r4b = { eq: redOf(4, 1), awaken: 0 }
    const r3 = { eq: redOf(3, 0), awaken: 5 }
    const n4 = { eq: GAME.equips.find((e) => e.quality < 5 && cellsOf(e) === 4)!, awaken: 0 } // 普通法宝最大 4 格
    const n1 = { eq: eqOf(1, 1), awaken: 0 }
    const sorted = [r4a, n4, r3, n1, r4b].sort((a, b) => compareSelected(GAME, a, b))
    expect(sorted).toEqual([n1, n4, r3, r4b, r4a])
  })
})

describe('filterCatalog', () => {
  it('形态筛选', () => {
    const r = filterCatalog(catalog, F({ forms: [6] }))
    expect(r.length).toBeGreaterThan(0)
    expect(r.every((e) => e.weaponForm === 6)).toBe(true)
  })

  it('占格数筛选', () => {
    const r = filterCatalog(catalog, F({ cellCounts: [1] }))
    expect(r.every((e) => e.cellCount === 1)).toBe(true)
    expect(r.map((e) => e.name)).toContain('蕴金戒')
  })

  it('维内「或」、维间「且」', () => {
    const r = filterCatalog(catalog, F({ elements: [1, 3], forms: [2] }))
    expect(r.length).toBeGreaterThan(0)
    expect(r.every((e) => [1, 3].includes(e.element) && e.weaponForm === 2)).toBe(true)
  })

  it('品阶筛选：任一阶命中', () => {
    const r = filterCatalog(catalog, F({ tiers: [5] }))
    expect(r.every((e) => e.tiers.some((t) => t.tier === 5))).toBe(true)
    expect(r.map((e) => e.name)).toContain('如意金箍棒')
  })

  it('按长老名搜索命中红装', () => {
    expect(filterCatalog(catalog, F({ keyword: '孙悟空' })).map((e) => e.name)).toEqual(['如意金箍棒'])
    expect(filterCatalog(catalog, F({ keyword: ' 金箍 ' })).map((e) => e.name)).toEqual(['如意金箍棒'])
  })

  it('facetCounts：计算某一维时忽略该维自身的已选条件', () => {
    const f = F({ elements: [1] })
    const c = facetCounts(catalog, f)
    expect(c.elements[2]).toBe(catalog.filter((e) => e.element === 2).length) // 木系计数不受「已选金」影响
    expect(Object.values(c.forms).reduce((a, b) => a + b, 0)).toBe(filterCatalog(catalog, f).length)
  })

  it('defaultTierOf：筛选了品阶时取命中的最高阶', () => {
    const yjj = catalog.find((e) => e.name === '蕴金戒')!
    expect(defaultTierOf(yjj, F())).toBe(4)
    expect(defaultTierOf(yjj, F({ tiers: [2, 3] }))).toBe(3)
  })
})

describe('awaken-text', () => {
  it('五类效果的描述', () => {
    expect(describeAwakenEffect({ type: 'self_per_adjacent', element: 1, attr: 2004, perUnit: 3000 }, GAME)).toBe('每相邻 1 件金系法宝，自身攻击力 +30%')
    expect(describeAwakenEffect({ type: 'self_mult', pct: 2000 }, GAME)).toBe('自身攻/防/血 +20%')
    expect(describeAwakenEffect({ type: 'adjacent_buff', element: 3, pct: 800 }, GAME)).toBe('相邻水系法宝攻/防/血 +8%')
    expect(describeAwakenEffect({ type: 'global_form', form: 6, pct: 1500 }, GAME)).toBe('背包内枪形态法宝攻/防/血 +15%（不含自身）')
    expect(describeAwakenEffect({ type: 'global_element', element: 1, pct: 1500 }, GAME)).toBe('背包内金系法宝攻/防/血 +15%（不含自身）')
  })

  it('全部觉醒数据都能生成描述；空等级显示“无新增效果”', () => {
    for (const entry of Object.values(GAME.awakenDb)) {
      const lv = describeAwakenLevels(entry, GAME)
      expect(lv).toHaveLength(entry.maxLevel)
      for (const l of lv) expect(l.lines.length).toBeGreaterThan(0)
    }
    const dp = GAME.elders.find((e) => e.name === '大鹏')!
    expect(describeAwakenLevels(GAME.awakenDb[dp.redEquipId], GAME)[1].lines).toEqual(['无新增效果'])
  })
})

describe('scoreLayout', () => {
  const swk = GAME.elders.find((e) => e.name === '孙悟空')!
  const configs = { [swk.id]: { elderId: swk.id, owned: true, star: 5, awakenCap: 5 } }
  const input = { elderConfigs: configs, talents: [], target: 'power' as const, weights: null, fillAll: false, locked: [] as number[] }

  it('与直接 evaluate 结果一致，并能和 toSavedPieces 往返', () => {
    const instances = buildInstances([
      { equipId: swk.redEquipId, copies: [{ awaken: 3 }] },
      { equipId: 140101, copies: [{ awaken: 0 }, { awaken: 0 }] },
    ], GAME)
    const snap = [{ uid: 0, r: 0, c: 0 }, { uid: 1, r: 0, c: 3 }, { uid: 2, r: 4, c: 5 }]
    const pieces = toSavedPieces(instances, snap)
    expect(pieces[0]).toEqual({ equipId: swk.redEquipId, awaken: 3, r: 0, c: 0 })
    const s = scoreLayout(pieces, input, GAME)
    expect(s.invalid).toEqual([])
    const ctx = buildContext(instances, input, GAME)
    const pl = s.placements.map((p, i) => ({ ...p, inst: instances[i] }))
    expect(s.score).toBe(evaluate(pl, ctx, scoringData(), false).powerTotal)
  })

  it('越界、重叠、压锁格的件报告为 invalid', () => {
    const s = scoreLayout([
      { equipId: 140101, awaken: 0, r: 0, c: 0 },
      { equipId: 140101, awaken: 0, r: 0, c: 0 }, // 重叠
      { equipId: 140101, awaken: 0, r: 6, c: 0 }, // 越界
      { equipId: 140101, awaken: 0, r: 1, c: 1 }, // 锁格
      { equipId: 1, awaken: 0, r: 2, c: 2 }, // 不存在
    ], { ...input, locked: [8] }, GAME)
    expect(s.placements).toHaveLength(1)
    expect(s.invalid).toHaveLength(4)
  })
})
