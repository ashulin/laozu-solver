/** 账号级长老配置（单一数据源）：是否拥有 / 星级 / 觉醒上限 */
import { defineStore } from 'pinia'
import { GAME } from '@/core/data'
import { maxAwakenCap, maxRedCopies } from '@/core/solver/red-rules'
import type { Elder, ElderConfig, Equip, AwakenEntry } from '@/core/types'
import { appStore } from '@/services/app-storage'
import { useBagStore } from './bag'

export interface ElderView {
  elder: Elder
  redEquip: Equip
  config: ElderConfig
  awaken?: AwakenEntry // undefined → 觉醒数据缺失
  maxCap: number
  maxCopies: number
}

const emptyConfig = (elderId: number): ElderConfig => ({ elderId, owned: false, star: 0, awakenCap: 0 })
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(v)))

export const useEldersStore = defineStore('elders', {
  state: () => {
    const loaded = appStore().load('elders') ?? []
    const configs: Record<number, ElderConfig> = {}
    for (const c of loaded) configs[c.elderId] = c
    return { configs }
  },
  getters: {
    config: (s) => (elderId: number): ElderConfig => s.configs[elderId] ?? emptyConfig(elderId),
    views(): ElderView[] {
      return GAME.elders.map((elder) => {
        const config = this.config(elder.id)
        return {
          elder,
          redEquip: GAME.equipById[elder.redEquipId],
          config,
          awaken: GAME.awakenDb[elder.redEquipId],
          maxCap: maxAwakenCap(GAME, elder.id),
          maxCopies: maxRedCopies(config),
        }
      })
    },
    ownedCount: (s) => Object.values(s.configs).filter((c) => c.owned).length,
  },
  actions: {
    update(elderId: number, patch: Partial<Omit<ElderConfig, 'elderId'>>) {
      const cur = this.config(elderId)
      const next: ElderConfig = { ...cur, ...patch, elderId }
      next.star = clamp(next.star, 0, 5)
      next.awakenCap = clamp(next.awakenCap, 0, maxAwakenCap(GAME, elderId))
      this.configs[elderId] = next
      // 下调觉醒上限时，已选中该红装超出上限的副本压到上限
      if (next.awakenCap < cur.awakenCap) {
        const elder = GAME.elderById[elderId]
        if (elder) useBagStore().clampAwaken(elder.redEquipId, next.awakenCap)
      }
    },
    setOwned(elderId: number, owned: boolean) {
      this.update(elderId, { owned })
    },
    setStar(elderId: number, star: number) {
      this.update(elderId, { star })
    },
    setAwakenCap(elderId: number, awakenCap: number) {
      this.update(elderId, { awakenCap })
    },
    replaceAll(list: ElderConfig[]) {
      this.configs = Object.fromEntries(list.map((c) => [c.elderId, { ...c }]))
    },
    persist() {
      appStore().save('elders', Object.values(this.configs).filter((c) => c.owned || c.star || c.awakenCap))
    },
  },
})
