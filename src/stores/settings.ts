/** 求解参数 + 目录筛选 */
import { defineStore } from 'pinia'
import { autoWorkerCount } from '@/core/solver/temperature'
import type { CatalogFilters, Target } from '@/core/types'
import { appStore } from '@/services/app-storage'
import { defaultFilters, defaultSettings, type SettingsData } from '@/services/persist-schema'

type ArrayFilterKey = Exclude<keyof CatalogFilters, 'keyword'>

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsData => appStore().load('settings') ?? defaultSettings(),
  getters: {
    threadCount: (s) => (s.threads === 'auto'
      ? autoWorkerCount(typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined)
      : s.threads),
    hasFilters: (s) => {
      const f = s.catalogFilters
      return !!(f.elements.length || f.forms.length || f.cellCounts.length || f.tiers.length || f.keyword.trim())
    },
  },
  actions: {
    setTarget(t: Target) {
      this.target = t
    },
    setWeight(attrId: number, w: number) {
      this.weights[attrId] = Number.isFinite(w) && w >= 0 ? w : 0
    },
    resetWeights() {
      this.weights = {}
    },
    setTalent(slot: number, id: number | null) {
      if (slot >= 0 && slot < 4) this.talents[slot] = id
    },
    toggleFilter<K extends ArrayFilterKey>(key: K, value: CatalogFilters[K][number]) {
      const list = this.catalogFilters[key] as unknown[]
      const i = list.indexOf(value)
      if (i >= 0) list.splice(i, 1)
      else list.push(value)
    },
    clearFilters() {
      this.catalogFilters = defaultFilters()
    },
    replaceAll(data: Partial<SettingsData>) {
      this.$patch({ ...data })
    },
    persist() {
      appStore().save('settings', this.$state)
    },
  },
})
