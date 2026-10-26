import { describe, expect, it } from 'vitest'
import { GAME } from '@/core/data'
import { awakenSelfMult, buildTalentMap, effBase, starBonusOf } from '@/core/solver/eff-base'
import { A_ATK, A_DEF, A_HP } from '@/core/solver/constants'
import { loadReference } from '../reference/load'

const jgb = GAME.equips.find((e) => e.name === '如意金箍棒')! // 孙悟空，黄长老
const elderJgb = GAME.elderByRedEquip[jgb.id]
const dp = GAME.equips.find((e) => e.name === '金翎荡云')! // 大鹏，蓝长老，maxLevel 3
const elderDp = GAME.elderByRedEquip[dp.id]

describe('starBonusOf', () => {
  it('取阈值 ≤ 星级的最高档', () => {
    expect([0, 1, 2, 3, 4, 5].map((s) => starBonusOf(elderJgb, s))).toEqual([0, 0, 6000, 6000, 10000, 15000])
    expect([0, 1, 2, 3, 4, 5].map((s) => starBonusOf(elderDp, s))).toEqual([0, 0, 4000, 4000, 6000, 10000])
  })
  it('无长老为 0', () => {
    expect(starBonusOf(undefined, 5)).toBe(0)
  })
})

describe('awakenSelfMult', () => {
  it('self_mult 按等级累积：觉2 +20%，觉4 再 +30%', () => {
    expect([0, 1, 2, 3, 4, 5].map((a) => awakenSelfMult(GAME.awakenDb, jgb.id, a))).toEqual([0, 0, 2000, 2000, 5000, 5000])
  })
  it('超过 maxLevel 的部分不计', () => {
    expect(awakenSelfMult(GAME.awakenDb, dp.id, 5)).toBe(awakenSelfMult(GAME.awakenDb, dp.id, 3))
  })
  it('无觉醒数据为 0', () => {
    expect(awakenSelfMult(GAME.awakenDb, 110101, 5)).toBe(0)
  })
})

describe('buildTalentMap', () => {
  it('按形态汇总，百分比属性映射到基础属性，重复天赋只算一次', () => {
    const jx = GAME.talents.find((t) => t.name === '剑痴')! // 剑 攻击+5%
    const jxzs = GAME.talents.find((t) => t.name === '剑仙转世')! // 剑 攻击+8%
    expect(buildTalentMap([jx.id, jx.id, jxzs.id, null], GAME.talentById)).toEqual({ 2: { [A_ATK]: 1300 } })
  })
})

describe('effBase', () => {
  const base = (attr: number) => jgb.base.find((b) => b.attr === attr)!.value
  const input = { elder: elderJgb, talentMap: {}, awakenDb: GAME.awakenDb }

  it('无星级无觉醒 = 基础值', () => {
    expect(effBase(jgb, A_ATK, { ...input, star: 0, awaken: 0 })).toBe(base(A_ATK))
  })
  it('5 星 +150%：基础 × 2.5 向下取整', () => {
    expect(effBase(jgb, A_HP, { ...input, star: 5, awaken: 0 })).toBe(Math.floor(base(A_HP) * 2.5))
  })
  it('觉醒 self_mult 独立乘算：5 星 + 觉4 = 基础 × 2.5 × 1.5', () => {
    expect(effBase(jgb, A_DEF, { ...input, star: 5, awaken: 4 })).toBe(Math.floor(base(A_DEF) * 2.5 * 1.5))
  })
  it('星级只对绑定长老的红装生效', () => {
    const plain = GAME.equipById[140101]
    expect(effBase(plain, A_ATK, { elder: elderJgb, star: 5, awaken: 0, talentMap: {}, awakenDb: GAME.awakenDb }))
      .toBe(plain.base.find((b) => b.attr === A_ATK)!.value)
  })
})

describe('effBase 对拍觉醒版', () => {
  const ref = loadReference(GAME)
  const talentIds = GAME.talents.filter((t) => ['剑痴', '枪仙转世', '御圣转世'].includes(t.name)).map((t) => t.id)
  const refTalent = ref.buildTalentMap(talentIds)
  const ourTalent = buildTalentMap(talentIds, GAME.talentById)

  it('天赋表一致', () => {
    expect(ourTalent).toEqual(JSON.parse(JSON.stringify(refTalent)))
  })

  it('所有红装 × 星级 0~5 × 觉醒 0~5 × 三围 全部一致', () => {
    let checked = 0
    for (const elder of GAME.elders) {
      const eq = GAME.equipById[elder.redEquipId]
      const refEq = { ...eq, elder }
      for (let star = 0; star <= 5; star++) {
        for (let aw = 0; aw <= 5; aw++) {
          for (const attr of [A_ATK, A_DEF, A_HP]) {
            const ours = effBase(eq, attr, { elder, star, awaken: aw, talentMap: ourTalent, awakenDb: GAME.awakenDb })
            const theirs = ref.effBase(refEq, { [eq.id]: star }, refTalent, attr, { [eq.id]: aw })
            expect(ours, `${eq.name} ${star}星 觉${aw} ${attr}`).toBe(theirs)
            checked++
          }
        }
      }
    }
    expect(checked).toBe(80 * 6 * 6 * 3)
  })
})
