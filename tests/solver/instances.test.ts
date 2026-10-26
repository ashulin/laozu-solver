import { describe, expect, it } from 'vitest'
import { GAME } from '@/core/data'
import { buildContext, buildInstances } from '@/core/solver/instances'
import { A_ATK } from '@/core/solver/constants'

const swk = GAME.elders.find((e) => e.name === '孙悟空')!
const jgb = GAME.equipById[swk.redEquipId]
const baseAtk = jgb.base.find((b) => b.attr === A_ATK)!.value

describe('buildInstances', () => {
  it('每份副本一个实例，uid 等于下标', () => {
    const inst = buildInstances([
      { equipId: jgb.id, copies: [{ awaken: 2 }, { awaken: 0 }] },
      { equipId: 140101, copies: [{ awaken: 0 }, { awaken: 0 }, { awaken: 0 }] },
    ], GAME)
    expect(inst.map((i) => i.uid)).toEqual([0, 1, 2, 3, 4])
    expect(inst.map((i) => i.awaken)).toEqual([2, 0, 0, 0, 0])
    expect(inst[0].shape).toBe(GAME.shapeById[jgb.shapeId])
  })

  it('觉醒截断到 0~maxLevel；非红装恒为 0；未知法宝跳过', () => {
    const dp = GAME.elders.find((e) => e.name === '大鹏')!
    const inst = buildInstances([
      { equipId: dp.redEquipId, copies: [{ awaken: 9 }, { awaken: -1 }] },
      { equipId: 140101, copies: [{ awaken: 3 }] },
      { equipId: 999999, copies: [{ awaken: 0 }] },
    ], GAME)
    expect(inst.map((i) => i.awaken)).toEqual([3, 0, 0])
  })
})

describe('buildContext', () => {
  const inst = buildInstances([{ equipId: jgb.id, copies: [{ awaken: 4 }, { awaken: 0 }] }], GAME)
  const configs = { [swk.id]: { elderId: swk.id, owned: true, star: 5, awakenCap: 5 } }

  it('按副本预计算：两份同款红装觉醒不同，有效攻击不同', () => {
    const ctx = buildContext(inst, { elderConfigs: configs, talents: [], target: 'power', weights: null, fillAll: false, locked: [] }, GAME)
    expect(ctx.effAtk[0]).toBe(Math.floor(baseAtk * 2.5 * 1.5))
    expect(ctx.effAtk[1]).toBe(Math.floor(baseAtk * 2.5))
    expect([ctx.R, ctx.C]).toEqual([6, 7])
    expect(ctx.weights).toBeNull()
  })

  it('未配置长老时星级按 0', () => {
    const ctx = buildContext(inst, { elderConfigs: {}, talents: [], target: 'power', weights: null, fillAll: false, locked: [] }, GAME)
    expect(ctx.effAtk[1]).toBe(baseAtk)
  })

  it('自定义权重：补齐全部属性，缺项取 nPower', () => {
    const ctx = buildContext(inst, { elderConfigs: configs, talents: [], target: 'weighted', weights: { 2001: 1 }, fillAll: true, locked: [3, 4] }, GAME)
    expect(Object.keys(ctx.weights!)).toHaveLength(GAME.attrs.length)
    expect(ctx.weights![2001]).toBe(1)
    expect(ctx.weights![2002]).toBe(GAME.attrById[2002].nPower)
    expect(ctx.locked).toEqual([3, 4])
    expect(ctx.fillAll).toBe(true)
  })
})
