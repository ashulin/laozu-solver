import { describe, expect, it } from 'vitest'
import { GAME } from '@/core/data'
import { defaultBag, defaultSettings, validateBag, validateElders, validateSettings } from '@/services/persist-schema'
import { exportBackup, KEYS, LocalStore, migrateFromJuexing, parseBackup, type StorageLike } from '@/services/storage'

class MemStorage implements StorageLike {
  map = new Map<string, string>()
  getItem(k: string) { return this.map.get(k) ?? null }
  setItem(k: string, v: string) { this.map.set(k, v) }
  removeItem(k: string) { this.map.delete(k) }
}

const swk = GAME.elders.find((e) => e.name === '孙悟空')!
const dp = GAME.elders.find((e) => e.name === '大鹏')!
const elders = [{ elderId: swk.id, owned: true, star: 4, awakenCap: 3 }]
const bag = { selected: [{ equipId: swk.redEquipId, copies: [{ awaken: 3 }, { awaken: 0 }] }], lockedCells: [0, 6], previousLayout: null }

describe('LocalStore', () => {
  it('保存后读取一致，带版本信封', () => {
    const mem = new MemStorage()
    const s = new LocalStore(mem, GAME)
    s.save('elders', elders)
    expect(JSON.parse(mem.getItem(KEYS.elders)!).v).toBe(1)
    expect(s.load('elders')).toEqual(elders)
  })

  it('缺失、损坏、版本不符、数据非法时返回 null', () => {
    const mem = new MemStorage()
    const s = new LocalStore(mem, GAME)
    expect(s.load('bag')).toBeNull()
    mem.setItem(KEYS.bag, '{oops')
    expect(s.load('bag')).toBeNull()
    mem.setItem(KEYS.bag, JSON.stringify({ v: 99, data: bag }))
    expect(s.load('bag')).toBeNull()
    mem.setItem(KEYS.bag, JSON.stringify({ v: 1, data: { ...bag, lockedCells: [99] } }))
    expect(s.load('bag')).toBeNull()
  })

  it('存储抛异常时不影响调用方', () => {
    const broken: StorageLike = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') }, removeItem: () => {} }
    const s = new LocalStore(broken, GAME)
    expect(() => s.save('elders', elders)).not.toThrow()
    expect(s.load('elders')).toBeNull()
  })
})

describe('校验', () => {
  it('长老：星级 0~5，觉醒上限不超过 maxLevel，id 必须存在且不重复', () => {
    expect(validateElders(elders, GAME)).toEqual(elders)
    expect(() => validateElders([{ ...elders[0], star: 6 }], GAME)).toThrow('star')
    expect(() => validateElders([{ elderId: dp.id, owned: true, star: 1, awakenCap: 4 }], GAME)).toThrow('0~3')
    expect(() => validateElders([{ ...elders[0], elderId: 1 }], GAME)).toThrow('不存在')
    expect(() => validateElders([elders[0], elders[0]], GAME)).toThrow('重复')
  })

  it('未知字段被丢弃', () => {
    const out = validateElders([{ ...elders[0], hack: '<script>' }], GAME)
    expect(out[0]).not.toHaveProperty('hack')
  })

  it('背包：法宝必须存在、份数 1~42、锁格 0~41', () => {
    expect(validateBag(bag, GAME)).toEqual(bag)
    expect(validateBag(defaultBag(), GAME)).toEqual(defaultBag())
    expect(() => validateBag({ ...bag, selected: [{ equipId: 1, copies: [{ awaken: 0 }] }] }, GAME)).toThrow('不存在')
    expect(() => validateBag({ ...bag, selected: [{ equipId: swk.redEquipId, copies: [] }] }, GAME)).toThrow('至少')
    expect(() => validateBag({ ...bag, lockedCells: [42] }, GAME)).toThrow('lockedCells')
  })

  it('设置：枚举值、天赋存在、权重范围', () => {
    const s = defaultSettings()
    expect(validateSettings(s, GAME)).toEqual(s)
    expect(() => validateSettings({ ...s, budgetSec: 999 }, GAME)).toThrow('budgetSec')
    expect(() => validateSettings({ ...s, talents: [123] }, GAME)).toThrow('天赋')
    expect(() => validateSettings({ ...s, weights: { 2001: -1 } }, GAME)).toThrow('weights')
    expect(() => validateSettings({ ...s, weights: { 9999: 1 } }, GAME)).toThrow('属性不存在')
    expect(() => validateSettings({ ...s, catalogFilters: { ...s.catalogFilters, forms: [1] } }, GAME)).toThrow('forms')
  })
})

describe('备份', () => {
  it('导出后可完整导入', () => {
    const text = exportBackup({ elders, bag, settings: defaultSettings(), savedBoards: [] })
    const r = parseBackup(text, GAME)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.available).toEqual(['elders', 'bag', 'settings', 'savedBoards'])
      expect(r.sections.elders).toEqual(elders)
      expect(r.sections.bag).toEqual(bag)
    }
  })

  it('可只导入选中的段', () => {
    const r = parseBackup(exportBackup({ elders, bag }), GAME, ['elders'])
    expect(r.ok && Object.keys(r.sections)).toEqual(['elders'])
  })

  it('任一选中段非法则整体拒绝', () => {
    const text = exportBackup({ elders, bag: { ...bag, lockedCells: [-1] } })
    const r = parseBackup(text, GAME)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('lockedCells')
    expect(parseBackup(text, GAME, ['elders']).ok).toBe(true)
  })

  it('非本工具文件、非 JSON、版本不符、过大', () => {
    expect(parseBackup('nope', GAME)).toEqual({ ok: false, error: '不是合法的 JSON' })
    expect(parseBackup('{"app":"x"}', GAME).ok).toBe(false)
    expect(parseBackup(JSON.stringify({ app: 'laozu-solver-next', v: 2, sections: {} }), GAME).ok).toBe(false)
    expect(parseBackup('x'.repeat(3 * 1024 * 1024), GAME)).toEqual({ ok: false, error: '文件过大' })
  })
})

describe('觉醒版迁移', () => {
  const jgb = GAME.equipById[swk.redEquipId]
  const legacy = {
    selected: [{ name: jgb.name, tier: 5, qty: 2 }, { name: '蕴金戒', tier: 4, qty: 3 }, { name: '不存在', tier: 1, qty: 1 }],
    elderStars: { [jgb.id]: 5 },
    awaken: { [jgb.id]: 3 },
    locked: [0, 6, 99],
    talents: ['', '', '', ''],
    target: 'weighted',
    fillAll: true,
  }

  it('星级/觉醒按法宝 → 长老配置；共享觉醒迁移为上限，副本取上限', () => {
    const r = migrateFromJuexing(JSON.stringify(legacy), GAME)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { sections, notes } = r.result
    expect(sections.elders).toEqual([{ elderId: swk.id, owned: true, star: 5, awakenCap: 3 }])
    expect(sections.bag.selected[0]).toEqual({ equipId: jgb.id, copies: [{ awaken: 3 }, { awaken: 3 }] })
    expect(sections.bag.selected[1].copies).toHaveLength(3)
    expect(sections.bag.lockedCells).toEqual([0, 6])
    expect(sections.settings.target).toBe('weighted')
    expect(sections.settings.talents).toEqual([null, null, null, null])
    expect(notes.join()).toContain('1 项无法识别')
    // 迁移结果能通过严格校验
    expect(() => validateElders(sections.elders, GAME)).not.toThrow()
    expect(() => validateBag(sections.bag, GAME)).not.toThrow()
  })

  it('非 JSON 报错', () => {
    expect(migrateFromJuexing('xx', GAME).ok).toBe(false)
  })
})
