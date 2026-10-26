import { describe, expect, it } from 'vitest'
import { GAME, isPlayableEquip } from '@/core/data'

describe('游戏数据完整性', () => {
  it('规模与觉醒版一致', () => {
    expect(GAME.equips).toHaveLength(375)
    expect(GAME.elders).toHaveLength(80)
    expect(Object.keys(GAME.awakenDb)).toHaveLength(64)
    expect(GAME.attrs).toHaveLength(12)
    expect(GAME.talents).toHaveLength(40)
  })

  it('长老品质分布：蓝16 紫32 黄32', () => {
    const count = { 2: 0, 3: 0, 4: 0 } as Record<number, number>
    for (const e of GAME.elders) count[e.quality]++
    expect(count).toEqual({ 2: 16, 3: 32, 4: 32 })
  })

  it('长老 id 唯一，每位长老绑定一件存在的五阶法宝', () => {
    expect(new Set(GAME.elders.map((e) => e.id)).size).toBe(80)
    for (const e of GAME.elders) {
      const eq = GAME.equipById[e.redEquipId]
      expect(eq, `${e.name} 的红装 ${e.redEquipId}`).toBeDefined()
      expect(eq.tier).toBe(5)
      expect(eq.elderId).toBe(e.id)
    }
  })

  it('反向引用只出现在绑定了长老的法宝上', () => {
    const withElder = GAME.equips.filter((e) => e.elderId !== undefined)
    expect(withElder).toHaveLength(80)
  })

  it('星级加成表：蓝长老 40/60/100%，紫黄长老 60/100/150%', () => {
    for (const e of GAME.elders) {
      const expected = e.quality === 2
        ? [[2, 4000], [4, 6000], [5, 10000]]
        : [[2, 6000], [4, 10000], [5, 15000]]
      expect(e.starBonus, e.name).toEqual(expected)
    }
  })

  it('觉醒数据都属于长老红装；maxLevel=3 的只有大鹏/赤烟驹/哈将', () => {
    const cap3: string[] = []
    for (const [equipId, entry] of Object.entries(GAME.awakenDb)) {
      const elder = GAME.elderByRedEquip[+equipId]
      expect(elder, `觉醒条目 ${equipId}`).toBeDefined()
      expect([3, 5]).toContain(entry.maxLevel)
      for (let lv = 1; lv <= entry.maxLevel; lv++) expect(entry.levels[lv], `${equipId} 觉醒${lv}`).toBeDefined()
      if (entry.maxLevel === 3) cap3.push(elder.name)
    }
    expect(cap3.sort()).toEqual(['哈将', '大鹏', '赤烟驹'].sort())
  })

  it('觉醒数据缺失的 16 件红装', () => {
    const missing = GAME.elders.filter((e) => !GAME.awakenDb[e.redEquipId]).map((e) => e.name)
    expect(missing).toHaveLength(16)
    expect(missing).toEqual(expect.arrayContaining(['鲲', '鲲·剑', '共工·剑']))
  })

  it('法宝引用的形状都存在；技能引用基本都存在', () => {
    for (const eq of GAME.equips) {
      expect(GAME.shapeById[eq.shapeId], `${eq.name} 形状 ${eq.shapeId}`).toBeDefined()
    }
    const missingSkills = GAME.equips.flatMap((eq) => eq.skillIds.filter((id) => !GAME.skillById[id]))
    expect(missingSkills).toEqual([])
  })

  it('形状 cellCount 在 1~5 之间', () => {
    for (const s of Object.values(GAME.shapeById)) {
      expect(s.cellCount).toBe(s.cells.length)
      expect(s.cellCount).toBeGreaterThanOrEqual(1)
      expect(s.cellCount).toBeLessThanOrEqual(5)
    }
  })

  it('描述中的 \\n 已转成换行', () => {
    const jgb = GAME.equips.find((e) => e.name === '如意金箍棒')!
    expect(jgb.desc).toContain('\n')
    expect(jgb.desc).not.toContain('\\n')
  })

  it('占位法宝被识别出来（灵肘/默认格子等）', () => {
    const placeholders = GAME.equips.filter((e) => !isPlayableEquip(e)).map((e) => e.name)
    expect(placeholders).toEqual(expect.arrayContaining(['灵肘', '默认格子']))
    expect(placeholders.length).toBeLessThanOrEqual(10)
  })
})
