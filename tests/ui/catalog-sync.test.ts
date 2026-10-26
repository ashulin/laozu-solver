// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { GAME } from '@/core/data'
import { memoryStorage, setStorageBackend } from '@/services/app-storage'
import { useBagStore } from '@/stores/bag'
import { enableCatalogElementSync } from '@/stores/catalog-sync'
import { useEldersStore } from '@/stores/elders'
import { useSettingsStore } from '@/stores/settings'
import SelectedList from '@/components/selected/SelectedList.vue'

const eqOf = (cells: number, element: number) =>
  GAME.equips.find((e) => GAME.shapeById[e.shapeId].cellCount === cells && e.element === element && e.quality < 5)!

let stop: (() => void) | null = null
beforeEach(() => {
  setStorageBackend(memoryStorage())
  setActivePinia(createPinia())
})
afterEach(() => {
  stop?.()
  stop = null
})

describe('目录元素筛选跟随已选法宝', () => {
  it('无已选 → 全部元素；单元素 → 该元素；双元素 → 两种；清空 → 恢复全部', () => {
    const bag = useBagStore()
    const f = useSettingsStore().catalogFilters
    stop = enableCatalogElementSync()
    expect(f.elements).toEqual([])
    bag.add(eqOf(2, 4).id)
    expect(f.elements).toEqual([4])
    bag.add(eqOf(1, 4).id)
    expect(f.elements).toEqual([4])
    bag.add(eqOf(1, 1).id)
    expect(f.elements).toEqual([1, 4])
    bag.removeItem(eqOf(1, 1).id)
    expect(f.elements).toEqual([4])
    bag.clear()
    expect(f.elements).toEqual([])
  })

  it('打开页面时按已有的已选法宝初始化', () => {
    useBagStore().add(eqOf(1, 3).id)
    useSettingsStore().catalogFilters.elements = []
    stop = enableCatalogElementSync()
    expect(useSettingsStore().catalogFilters.elements).toEqual([3])
  })

  it('手动调整的元素筛选保留，直到已选法宝的元素变化；改数量不算变化', () => {
    const bag = useBagStore()
    const settings = useSettingsStore()
    stop = enableCatalogElementSync()
    bag.add(eqOf(1, 4).id)
    settings.toggleFilter('elements', 2)
    expect(settings.catalogFilters.elements).toEqual([4, 2])
    bag.add(eqOf(1, 4).id)
    bag.add(eqOf(2, 4).id)
    expect(settings.catalogFilters.elements).toEqual([4, 2])
    bag.add(eqOf(1, 5).id)
    expect(settings.catalogFilters.elements).toEqual([4, 5])
  })

  it('其它维度的筛选不受影响', () => {
    const settings = useSettingsStore()
    stop = enableCatalogElementSync()
    settings.toggleFilter('forms', 6)
    useBagStore().add(eqOf(1, 4).id)
    expect(settings.catalogFilters).toMatchObject({ elements: [4], forms: [6] })
  })
})

describe('已选法宝排序', () => {
  it('普通法宝按占格数从小到大显示，与添加顺序无关', () => {
    const bag = useBagStore()
    for (const eq of [eqOf(4, 1), eqOf(1, 4), eqOf(3, 2), eqOf(1, 1), eqOf(2, 3)]) bag.add(eq.id)
    const w = mount(SelectedList)
    const cells = w.findAll('.item b').map((b) => GAME.shapeById[GAME.equips.find((e) => e.name === b.text())!.shapeId].cellCount)
    expect(cells).toEqual([1, 1, 2, 3, 4])
    expect(bag.selected.map((it) => it.equipId)[0]).toBe(eqOf(4, 1).id) // 只影响显示，不改存储顺序
  })

  it('同格数普通法宝按品阶低到高；红装排在最后，同格数按觉醒未觉醒到已觉醒', () => {
    const bag = useBagStore()
    const elders = useEldersStore()
    const reds = GAME.equips.filter((e) => e.elderId !== undefined && GAME.shapeById[e.shapeId].cellCount === 4).slice(0, 2)
    for (const r of reds) elders.update(r.elderId!, { owned: true, star: 3, awakenCap: 3 })
    const lowTier = GAME.equips.find((e) => e.quality < 5 && e.tier === 1 && GAME.shapeById[e.shapeId].cellCount === 1)!
    const highTier = GAME.equips.find((e) => e.quality < 5 && e.tier === 4 && GAME.shapeById[e.shapeId].cellCount === 1)!
    for (const id of [reds[0].id, highTier.id, reds[1].id, lowTier.id, eqOf(4, 2).id]) expect(bag.add(id).ok).toBe(true)
    bag.setCopyAwaken(reds[0].id, 0, 2) // 新增副本默认觉醒 = 上限，这里显式设定
    bag.setCopyAwaken(reds[1].id, 0, 0)
    const w = mount(SelectedList)
    const names = w.findAll('.item b').map((b) => b.text())
    expect(names.slice(0, 2)).toEqual([lowTier.name, highTier.name])
    expect(names.slice(-2)).toEqual([reds[1].name, reds[0].name])
  })
})
