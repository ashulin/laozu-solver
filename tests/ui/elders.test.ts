// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { GAME } from '@/core/data'
import { memoryStorage, setStorageBackend } from '@/services/app-storage'
import { useBagStore } from '@/stores/bag'
import { useEldersStore } from '@/stores/elders'
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
  it('勾选拥有、调整星级与觉醒上限写回 store', async () => {
    const w = mount(ElderCard, { props: { view: viewOf(swk.id) } })
    expect(w.text()).toContain('孙悟空')
    expect(w.text()).toContain('如意金箍棒')
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

  it('觉醒数据缺失时禁用上限设置并标红提示', () => {
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
    expect(w.text()).toContain('未拥有')
    useEldersStore().update(swk.id, { owned: true, star: 3, awakenCap: 2 })
    await w.vm.$nextTick()
    expect(w.text()).toContain('★3')
    expect(w.text()).toContain('觉醒≤2')
  })
})

describe('EldersView', () => {
  it('列出 80 位长老；搜索与「只看已拥有」生效；已拥有排前面', async () => {
    useEldersStore().setOwned(swk.id, true)
    const w = mount(EldersView)
    expect(w.findAll('.elder-card')).toHaveLength(80)
    expect(w.find('.elder-card .name').text()).toBe('孙悟空')
    await w.find('input[type=search]').setValue('金箍')
    expect(w.findAll('.elder-card')).toHaveLength(1)
    await w.find('input[type=search]').setValue('')
    await w.findAll('.chip').find((c) => c.text().includes('只看已拥有'))!.find('input').trigger('change')
    expect(w.findAll('.elder-card')).toHaveLength(1)
  })

  it('下调觉醒上限联动已选列表', async () => {
    const e = useEldersStore()
    e.update(swk.id, { owned: true, star: 3, awakenCap: 3 })
    useBagStore().add(swk.redEquipId, 2)
    const w = mount(EldersView)
    const card = w.findAll('.elder-card').find((c) => c.text().includes('孙悟空'))!
    await card.findAll('button[aria-label="减少"]')[1].trigger('click')
    expect(useBagStore().selected[0].copies.map((c) => c.awaken)).toEqual([2, 2])
  })
})
