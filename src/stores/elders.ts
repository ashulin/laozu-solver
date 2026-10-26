/**
 * 账号级长老配置（单一数据源）：是否拥有 / 星级 / 觉醒。
 * 目前只有一个默认账号（不支持切换），默认拥有全部长老、0 星、觉醒 0。
 */
import { defineStore } from 'pinia'
import { GAME } from '@/core/data'
import { maxAwakenCap, maxRedCopies } from '@/core/solver/red-rules'
import type { Elder, ElderConfig, Equip, AwakenEntry } from '@/core/types'
import { appStore } from '@/services/app-storage'
import { useBagStore } from './bag'

export const DEFAULT_ACCOUNT_NAME = '默认账号'

export interface ElderView {
  elder: Elder
  redEquip: Equip
  config: ElderConfig
  awaken?: AwakenEntry // undefined → 觉醒数据缺失
  maxCap: number
  maxCopies: number
}

/** 默认账号下未单独设置过的长老：已拥有、0 星、觉醒 0 */
export const defaultElderConfig = (elderId: number): ElderConfig => ({ elderId, owned: true, star: 0, awakenCap: 0 })
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(v)))

export const useEldersStore = defineStore('elders', {
  state: () => {
    const loaded = appStore().load('elders') ?? []
    const configs: Record<number, ElderConfig> = {}
    for (const c of loaded) configs[c.elderId] = c
    return { configs }
  },
  getters: {
    config: (s) => (elderId: number): ElderConfig => s.configs[elderId] ?? defaultElderConfig(elderId),
    /** 全部长老的完整配置（含默认值），用于持久化与备份 */
    allConfigs(): ElderConfig[] {
      return GAME.elders.map((e) => ({ ...this.config(e.id) }))
    },
    /** elderId → 完整配置（含默认值）；求解与红装校验必须用它，不能直接读 configs */
    configMap(): Record<number, ElderConfig> {
      return Object.fromEntries(GAME.elders.map((e) => [e.id, this.config(e.id)]))
    },
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
    ownedCount(): number {
      return GAME.elders.filter((e) => this.config(e.id).owned).length
    },
  },
  actions: {
    update(elderId: number, patch: Partial<Omit<ElderConfig, 'elderId'>>) {
      const cur = this.config(elderId)
      const next: ElderConfig = { ...cur, ...patch, elderId }
      next.star = clamp(next.star, 0, 5)
      next.awakenCap = clamp(next.awakenCap, 0, maxAwakenCap(GAME, elderId))
      this.configs[elderId] = next
      // 下调长老觉醒时，已选中该红装超出的副本压到新等级
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
      // 保存全部长老的完整配置：「未拥有」也要显式落盘，否则下次会回到默认的「已拥有」
      appStore().save('elders', this.allConfigs)
    },
  },
})
