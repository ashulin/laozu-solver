/**
 * 目录元素筛选跟随已选法宝：
 * 已选法宝涉及的元素集合一变化（以及页面打开时），就把目录的元素筛选设为该集合；没有已选法宝时清空 = 全部元素。
 * 只在集合变化时覆盖，用户之后手动调整的元素筛选会保留，直到已选法宝的元素再次变化。
 */
import { watch } from 'vue'
import { GAME } from '@/core/data'
import { bagElements } from '@/core/catalog'
import { useBagStore } from './bag'
import { useSettingsStore } from './settings'

export function enableCatalogElementSync(): () => void {
  const bag = useBagStore()
  const settings = useSettingsStore()
  return watch(
    () => bagElements(GAME, bag.selected.map((it) => it.equipId)).join(','),
    (key) => {
      settings.catalogFilters.elements = key ? key.split(',').map(Number) as typeof settings.catalogFilters.elements : []
    },
    { flush: 'sync', immediate: true },
  )
}
