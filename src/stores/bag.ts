/** 背包：已选法宝（红装逐副本觉醒）/ 未开放格 / 之前摆盘 */
import { defineStore } from 'pinia'
import { GAME } from '@/core/data'
import { checkRedEquips, MAX_RED_KINDS, maxRedCopies, redItemsOf } from '@/core/solver/red-rules'
import type { SavedPiece, SelectedItem } from '@/core/types'
import { appStore } from '@/services/app-storage'
import { defaultBag, MAX_COPIES_PER_ITEM } from '@/services/persist-schema'
import { useEldersStore } from './elders'

export type AddResult = { ok: true } | { ok: false; reason: string }

export const useBagStore = defineStore('bag', {
  state: () => appStore().load('bag') ?? defaultBag(),
  getters: {
    totalPieces: (s) => s.selected.reduce((a, it) => a + it.copies.length, 0),
    totalCells: (s) => s.selected.reduce((a, it) => a + it.copies.length * GAME.shapeById[GAME.equipById[it.equipId].shapeId].cellCount, 0),
    usableCells: (s) => 42 - s.lockedCells.length,
    countOf: (s) => (equipId: number) => s.selected.find((it) => it.equipId === equipId)?.copies.length ?? 0,
    redKinds: (s) => s.selected.filter((it) => GAME.equipById[it.equipId]?.elderId !== undefined).map((it) => it.equipId),
    warnings(s): string[] {
      return checkRedEquips(redItemsOf(s.selected), useEldersStore().configs, GAME)
    },
  },
  actions: {
    /** 添加副本。红装：须已拥有、不超过可携带数量、种类不超过 2；新副本觉醒默认取长老上限 */
    add(equipId: number, count = 1): AddResult {
      const eq = GAME.equipById[equipId]
      if (!eq) return { ok: false, reason: '未知法宝' }
      let awaken = 0
      if (eq.elderId !== undefined) {
        const elder = GAME.elderById[eq.elderId]
        const cfg = useEldersStore().config(elder.id)
        if (!cfg.owned) return { ok: false, reason: `请先在「长老管理」中把「${elder.name}」标记为已拥有` }
        const max = maxRedCopies(cfg)
        if (this.countOf(equipId) + count > max) {
          return { ok: false, reason: `「${elder.name}」${cfg.star} 星最多带 ${max} 件${eq.name}${max < 2 ? '（3 星可带 2 件）' : ''}` }
        }
        if (!this.redKinds.includes(equipId) && this.redKinds.length >= MAX_RED_KINDS) {
          return { ok: false, reason: `单局最多选 ${MAX_RED_KINDS} 位长老，红装最多 ${MAX_RED_KINDS} 种` }
        }
        awaken = cfg.awakenCap
      }
      if (!this.selected.some((it) => it.equipId === equipId)) this.selected.push({ equipId, copies: [] })
      // 必须经由 this.selected 取回响应式代理再修改，直接改原始对象不会触发响应与持久化
      const item = this.selected.find((it) => it.equipId === equipId)!
      const room = MAX_COPIES_PER_ITEM - item.copies.length
      for (let i = 0; i < Math.min(count, room); i++) item.copies.push({ awaken })
      return { ok: true }
    },
    removeCopy(equipId: number, index?: number) {
      const item = this.selected.find((it) => it.equipId === equipId)
      if (!item) return
      item.copies.splice(index ?? item.copies.length - 1, 1)
      if (!item.copies.length) this.selected = this.selected.filter((it) => it !== item)
    },
    removeItem(equipId: number) {
      this.selected = this.selected.filter((it) => it.equipId !== equipId)
    },
    clear() {
      this.selected = []
    },
    /** 设置某份副本的觉醒等级（截断到 0~长老上限） */
    setCopyAwaken(equipId: number, index: number, awaken: number) {
      const item = this.selected.find((it) => it.equipId === equipId)
      const eq = GAME.equipById[equipId]
      if (!item || !item.copies[index] || eq?.elderId === undefined) return
      const cap = useEldersStore().config(eq.elderId).awakenCap
      item.copies[index].awaken = Math.max(0, Math.min(cap, Math.floor(awaken)))
    },
    clampAwaken(equipId: number, cap: number) {
      const item = this.selected.find((it) => it.equipId === equipId)
      if (!item) return
      for (const c of item.copies) if (c.awaken > cap) c.awaken = cap
    },
    toggleLocked(cell: number) {
      if (cell < 0 || cell >= 42) return
      const i = this.lockedCells.indexOf(cell)
      if (i >= 0) this.lockedCells.splice(i, 1)
      else this.lockedCells.push(cell)
    },
    resetLocked() {
      this.lockedCells = []
    },
    setPreviousLayout(layout: SavedPiece[] | null) {
      this.previousLayout = layout
    },
    replaceSelected(selected: SelectedItem[]) {
      this.selected = selected.map((it) => ({ equipId: it.equipId, copies: it.copies.map((c) => ({ ...c })) }))
    },
    persist() {
      appStore().save('bag', { selected: this.selected, lockedCells: this.lockedCells, previousLayout: this.previousLayout })
    },
  },
})
