// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { GAME } from '@/core/data'
import { emptyElderFilter, matchElder, type ElderFilter } from '@/core/elder-filter'
import { ELDER_QUALITY_NAME } from '@/core/types'
import { memoryStorage, setStorageBackend } from '@/services/app-storage'
import { useBagStore } from '@/stores/bag'
import { defaultElderConfig, useEldersStore } from '@/stores/elders'
import ElderCard from '@/components/elders/ElderCard.vue'
import ElderTag from '@/components/common/ElderTag.vue'
import EldersView from '@/views/EldersView.vue'

const swk = GAME.elders.find((e) => e.name === '孙悟空')!
const kun = GAME.elders.find((e) => e.name === '鲲')!

beforeEach(() => {
  setStorageBackend(memoryStorage())
  setActivePinia(createPinia())
})

const viewOf = (id: number) => useEldersStore().views.find((v) => v.elder.id === id)!

describe('ElderCard', () => {
  it('取消/勾选拥有、调整星级与觉醒写回 store', async () => {
    const w = mount(ElderCard, { props: { view: viewOf(swk.id) } })
    expect(w.text()).toContain('孙悟空')
    expect(w.text()).toContain('如意金箍棒')
    expect((w.find('input[type=checkbox]').element as HTMLInputElement).checked).toBe(true) // 默认账号默认拥有
    await w.find('input[type=checkbox]').setValue(false)
    expect(useEldersStore().config(swk.id).owned).toBe(false)
    await w.find('input[type=checkbox]').setValue(true)
    const plus = w.findAll('button[aria-label="增加"]')
    await plus[0].trigger('click')
    await plus[0].trigger('click')
    await plus[1].trigger('click')
    expect(useEldersStore().config(swk.id)).toEqual({ elderId: swk.id, owned: true, star: 2, awakenCap: 1 })
    expect(w.text()).toContain('基础三围 +60%')
    expect(w.text()).toContain('可带 1 件')
  })

  it('展开觉醒效果，已解锁的等级高亮', async () => {
    useEldersStore().update(swk.id, { owned: true, awakenCap: 2 })
    const w = mount(ElderCard, { props: { view: viewOf(swk.id) } })
    await w.findAll('button').find((b) => b.text() === '查看效果')!.trigger('click')
    const items = w.findAll('.levels li')
    expect(items).toHaveLength(5)
    expect(items.filter((li) => li.classes('on'))).toHaveLength(2)
  })

  it('觉醒数据缺失时禁用觉醒设置并标红提示', () => {
    const w = mount(ElderCard, { props: { view: viewOf(kun.id) } })
    expect(w.text()).toContain('觉醒数据缺失')
    expect(w.findAll('button[aria-label="增加"]')).toHaveLength(1) // 只有星级步进器
  })
})

describe('ElderTag', () => {
  it('普通法宝不显示；红装显示长老名与配置', async () => {
    expect(mount(ElderTag, { props: { equipId: 140101 } }).html()).not.toContain('elder-tag')
    const w = mount(ElderTag, { props: { equipId: swk.redEquipId } })
    expect(w.text()).toContain('长老·孙悟空')
    expect(w.text()).toContain('★0')
    useEldersStore().setOwned(swk.id, false)
    await w.vm.$nextTick()
    expect(w.text()).toContain('未拥有')
    useEldersStore().update(swk.id, { owned: true, star: 3, awakenCap: 2 })
    await w.vm.$nextTick()
    expect(w.text()).toContain('★3')
    expect(w.text()).toContain('觉醒2')
  })
})

describe('EldersView', () => {
  it('列出 80 位长老；搜索与「只看已拥有」生效；已拥有排前面', async () => {
    for (const e of GAME.elders) if (e.id !== swk.id) useEldersStore().setOwned(e.id, false)
    const w = mount(EldersView)
    expect(w.text()).toContain('账号：默认账号')
    expect(w.findAll('.elder-card')).toHaveLength(80)
    expect(w.find('.elder-card .name').text()).toBe('孙悟空')
    await w.find('input[type=search]').setValue('金箍')
    expect(w.findAll('.elder-card')).toHaveLength(1)
    await w.find('input[type=search]').setValue('')
    await w.findAll('.chip').find((c) => c.text().includes('只看已拥有'))!.find('input').trigger('change')
    expect(w.findAll('.elder-card')).toHaveLength(1)
  })

  it('下调长老觉醒联动已选列表', async () => {
    const e = useEldersStore()
    e.update(swk.id, { owned: true, star: 3, awakenCap: 3 })
    useBagStore().add(swk.redEquipId, 2)
    const w = mount(EldersView)
    const card = w.findAll('.elder-card').find((c) => c.text().includes('孙悟空'))!
    await card.findAll('button[aria-label="减少"]')[1].trigger('click')
    expect(useBagStore().selected[0].copies.map((c) => c.awaken)).toEqual([2, 2])
  })

  it('品级显示为优品/良品/凡品（不再出现黄紫蓝）', () => {
    const w = mount(EldersView)
    const chips = w.findAll('.chip').map((c) => c.text())
    expect(chips.filter((t) => /^(优品|良品|凡品)/.test(t)).map((t) => t.replace(/\d+$/, ''))).toEqual(['优品', '良品', '凡品'])
    expect(chips.some((t) => /^[黄紫蓝]$/.test(t))).toBe(false)
    expect(w.findAll('.elder-card').find((c) => c.text().includes('孙悟空'))!.find('.quality').text()).toBe(ELDER_QUALITY_NAME[swk.quality])
    expect(w.text()).not.toContain('觉醒上限')
  })

  it('元素、形态快速筛选可叠加，数量与命中一致', async () => {
    const w = mount(EldersView)
    const chip = (t: string) => w.findAll('.chip').find((c) => c.text().startsWith(t))!
    const expectCount = (pred: (eq: (typeof GAME.equips)[number]) => boolean) =>
      expect(w.findAll('.elder-card')).toHaveLength(GAME.elders.filter((e) => pred(GAME.equipById[e.redEquipId])).length)

    await chip('金').trigger('click')
    expectCount((eq) => eq.element === 1)
    expect(chip('剑').find('small').text()).toBe(String(GAME.elders.filter((e) => { const q = GAME.equipById[e.redEquipId]; return q.element === 1 && q.weaponForm === 2 }).length))

    await chip('剑').trigger('click')
    expectCount((eq) => eq.element === 1 && eq.weaponForm === 2)

    await chip('火').trigger('click')
    expectCount((eq) => [1, 4].includes(eq.element) && eq.weaponForm === 2)

    await w.findAll('button').find((b) => b.text() === '清空筛选')!.trigger('click')
    expect(w.findAll('.elder-card')).toHaveLength(80)
  })
})

describe('matchElder', () => {
  it('维内或、维间且；关键字匹配长老名或法宝名', () => {
    const cfg = defaultElderConfig(swk.id)
    const eq = GAME.equipById[swk.redEquipId]
    const f = (p: Partial<ElderFilter>): ElderFilter => ({ ...emptyElderFilter(), ...p })
    expect(matchElder(GAME, swk, cfg, f({}))).toBe(true)
    expect(matchElder(GAME, swk, cfg, f({ elements: [eq.element] }))).toBe(true)
    expect(matchElder(GAME, swk, cfg, f({ elements: [eq.element === 1 ? 2 : 1] }))).toBe(false)
    expect(matchElder(GAME, swk, cfg, f({ forms: [eq.weaponForm], qualities: [swk.quality] }))).toBe(true)
    expect(matchElder(GAME, swk, cfg, f({ keyword: eq.name.slice(0, 2) }))).toBe(true)
    expect(matchElder(GAME, swk, { ...cfg, owned: false }, f({ ownedOnly: true }))).toBe(false)
  })
})
