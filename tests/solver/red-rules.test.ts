import { describe, expect, it } from 'vitest'
import { GAME } from '@/core/data'
import { checkRedEquips, maxAwakenCap, maxRedCopies, redItemsOf } from '@/core/solver/red-rules'
import type { ElderConfig } from '@/core/types'

const cfg = (p: Partial<ElderConfig>): ElderConfig => ({ elderId: 0, owned: true, star: 0, awakenCap: 0, ...p })
const byName = (n: string) => GAME.elders.find((e) => e.name === n)!

describe('maxRedCopies', () => {
  it('未拥有 0；拥有 1；3 星起 2', () => {
    expect(maxRedCopies(undefined)).toBe(0)
    expect(maxRedCopies(cfg({ owned: false, star: 5 }))).toBe(0)
    expect([0, 1, 2, 3, 4, 5].map((star) => maxRedCopies(cfg({ star })))).toEqual([1, 1, 1, 2, 2, 2])
  })
})

describe('maxAwakenCap', () => {
  it('一般为 5；大鹏为 3；无觉醒数据为 0；未知长老为 0', () => {
    expect(maxAwakenCap(GAME, byName('孙悟空').id)).toBe(5)
    expect(maxAwakenCap(GAME, byName('大鹏').id)).toBe(3)
    expect(maxAwakenCap(GAME, byName('鲲').id)).toBe(0)
    expect(maxAwakenCap(GAME, -1)).toBe(0)
  })
})

describe('checkRedEquips', () => {
  const swk = byName('孙悟空')
  const ce = byName('嫦娥')
  const gg = byName('共工')
  const configs = {
    [swk.id]: cfg({ elderId: swk.id, star: 3, awakenCap: 2 }),
    [ce.id]: cfg({ elderId: ce.id, star: 1, awakenCap: 5 }),
    [gg.id]: cfg({ elderId: gg.id, star: 5, awakenCap: 5 }),
  }

  it('合规：孙悟空 3 星带 2 件，觉醒不超过上限', () => {
    expect(checkRedEquips([{ equipId: swk.redEquipId, awakens: [2, 0] }], configs, GAME)).toEqual([])
  })

  it('普通法宝不参与校验', () => {
    expect(checkRedEquips([{ equipId: 140101, awakens: [0, 0, 0] }], configs, GAME)).toEqual([])
  })

  it('超过 2 种', () => {
    const w = checkRedEquips([
      { equipId: swk.redEquipId, awakens: [0] },
      { equipId: ce.redEquipId, awakens: [0] },
      { equipId: gg.redEquipId, awakens: [0] },
    ], configs, GAME)
    expect(w.some((s) => s.includes('3 种'))).toBe(true)
  })

  it('星级不足带 2 件', () => {
    const w = checkRedEquips([{ equipId: ce.redEquipId, awakens: [0, 0] }], configs, GAME)
    expect(w).toEqual([expect.stringContaining('1 星最多带 1 件')])
  })

  it('觉醒超过上限', () => {
    const w = checkRedEquips([{ equipId: swk.redEquipId, awakens: [3] }], configs, GAME)
    expect(w).toEqual([expect.stringContaining('超过长老「孙悟空」的觉醒上限 2')])
  })

  it('长老未拥有', () => {
    const dp = byName('大鹏')
    const w = checkRedEquips([{ equipId: dp.redEquipId, awakens: [0] }], configs, GAME)
    expect(w).toEqual([expect.stringContaining('未标记为已拥有')])
  })

  it('同一红装分多条记录时合并计数', () => {
    const w = checkRedEquips(redItemsOf([
      { equipId: ce.redEquipId, copies: [{ awaken: 0 }] },
      { equipId: ce.redEquipId, copies: [{ awaken: 0 }] },
    ]), configs, GAME)
    expect(w).toEqual([expect.stringContaining('×2')])
  })
})
