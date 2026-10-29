/** 背包：已选法宝（红装逐副本觉醒）/ 未开放格 / 之前摆盘 */
import { defineStore } from 'pinia'
import { newCopyId } from '@/core/copy-id'
import { GAME } from '@/core/data'
import { reviewRecognition } from '@/core/ocr/draft'
import type { RecognitionCell } from '@/core/ocr/recognize'
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
      return checkRedEquips(redItemsOf(s.selected), useEldersStore().configMap, GAME)
    },
  },
  actions: {
    importRecognition(cells: RecognitionCell[], skipPending = false): AddResult {
      const review = reviewRecognition(cells, useEldersStore().configMap, { skipPending })
      if (!review.data) return { ok: false, reason: review.errors.join('；') }
      this.$patch(review.data)
      return { ok: true }
    },
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
      for (let i = 0; i < Math.min(count, room); i++) item.copies.push({ awaken, id: newCopyId() })
      return { ok: true }
    },
    /** 删除单件：可按副本身份指定是哪一件（不传则删最后一件） */
    removeCopy(equipId: number, indexOrId?: number | string) {
      const item = this.selected.find((it) => it.equipId === equipId)
      if (!item) return
      const i = typeof indexOrId === 'string'
        ? item.copies.findIndex((c) => c.id === indexOrId)
        : indexOrId ?? item.copies.length - 1
      if (i < 0 || i >= item.copies.length) return
      item.copies.splice(i, 1)
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
      this.selected = selected.map((it) => ({ equipId: it.equipId, copies: it.copies.map((c) => ({ ...c, id: c.id ?? newCopyId() })) }))
    },
    /** 调整某一件的品阶（普通法宝升/降阶）；红装不支持，占格不同的阶不支持 */
    setCopyTier(equipId: number, copyId: string, tier: number): AddResult {
      const item = this.selected.find((it) => it.equipId === equipId)
      const index = item?.copies.findIndex((c) => c.id === copyId) ?? -1
      if (!item || index < 0) return { ok: false, reason: '找不到这一件' }
      const eq = GAME.equipById[equipId]
      if (eq?.elderId !== undefined) return { ok: false, reason: '红装不支持改阶' }
      const target = GAME.equips.find((e) => e.name === eq.name && e.tier === tier)
      if (!target || target.id === equipId) return { ok: false, reason: '没有可选的这个阶' }
      if (target.shapeId !== eq.shapeId) return { ok: false, reason: '该阶占格不同，无法改阶' }
      const copy = item.copies[index]
      item.copies.splice(index, 1)
      if (!item.copies.length) this.selected = this.selected.filter((it) => it !== item)
      if (!this.selected.some((it) => it.equipId === target.id)) this.selected.push({ equipId: target.id, copies: [] })
      const to = this.selected.find((it) => it.equipId === target.id)!
      to.copies.push({ awaken: 0, id: copy.id ?? newCopyId() })
      // 摆盘与已选列表绑定：这一件升阶后，「之前摆盘」里对应的那件也跟着升（占格已校验一致）
      const placed = this.previousLayout?.find((p) => p.equipId === equipId)
      if (placed) placed.equipId = target.id
      return { ok: true }
    },
    /** 「之前摆盘」某位置 → 对应的已选副本（按 equipId + 觉醒匹配，取第一件）。用于摆盘上就地编辑时联动已选列表。 */
    placedCopy(equipId: number, awaken: number): { item: SelectedItem; index: number } | null {
      const item = this.selected.find((it) => it.equipId === equipId)
      if (!item || !item.copies.length) return null
      const exact = item.copies.findIndex((c) => c.awaken === awaken)
      return { item, index: exact >= 0 ? exact : 0 }
    },
    /** 「之前摆盘」里锚点在 (r,c) 的普通法宝升一阶，同时联动已选列表与摆盘显示 */
    upgradePlaced(r: number, c: number): AddResult {
      const pl = this.previousLayout
      const i = pl ? pl.findIndex((p) => p.r === r && p.c === c) : -1
      if (!pl || i < 0) return { ok: false, reason: '找不到这件法宝' }
      const placed = pl[i]
      const eq = GAME.equipById[placed.equipId]
      if (eq?.elderId !== undefined) return { ok: false, reason: '红装不支持改阶' }
      const next = GAME.equips.find((e) => e.name === eq.name && e.shapeId === eq.shapeId && e.tier === eq.tier + 1)
      if (!next) return { ok: false, reason: '已是最高阶' }
      // 联动已选：把一件匹配副本移到新阶（保留副本身份）
      const found = this.placedCopy(placed.equipId, placed.awaken)
      if (found) {
        const copy = found.item.copies[found.index]
        found.item.copies.splice(found.index, 1)
        if (!found.item.copies.length) this.selected = this.selected.filter((it) => it !== found.item)
        if (!this.selected.some((it) => it.equipId === next.id)) this.selected.push({ equipId: next.id, copies: [] })
        this.selected.find((it) => it.equipId === next.id)!.copies.push({ awaken: 0, id: copy.id ?? newCopyId() })
      }
      placed.equipId = next.id
      placed.awaken = 0
      return { ok: true }
    },
    /** 删除「之前摆盘」里锚点在 (r,c) 的法宝，并移除已选列表里对应的一件 */
    removePlaced(r: number, c: number) {
      const pl = this.previousLayout
      const i = pl ? pl.findIndex((p) => p.r === r && p.c === c) : -1
      if (!pl || i < 0) return
      const placed = pl[i]
      const found = this.placedCopy(placed.equipId, placed.awaken)
      if (found) {
        found.item.copies.splice(found.index, 1)
        if (!found.item.copies.length) this.selected = this.selected.filter((it) => it !== found.item)
      }
      pl.splice(i, 1)
    },
    /** 设置「之前摆盘」里锚点在 (r,c) 的红装觉醒等级，并联动已选列表（截断到 0~长老上限） */
    setPlacedAwaken(r: number, c: number, awaken: number) {
      const pl = this.previousLayout
      const i = pl ? pl.findIndex((p) => p.r === r && p.c === c) : -1
      if (!pl || i < 0) return
      const placed = pl[i]
      const eq = GAME.equipById[placed.equipId]
      if (eq?.elderId === undefined) return
      const cap = useEldersStore().config(eq.elderId).awakenCap
      const value = Math.max(0, Math.min(cap, Math.floor(awaken)))
      const found = this.placedCopy(placed.equipId, placed.awaken)
      if (found) found.item.copies[found.index].awaken = value
      placed.awaken = value
    },
    /** 用某个摆盘里的法宝替换已选列表（同款合并，每件保留自己的觉醒等级） */
    adoptLayout(pieces: SavedPiece[]) {
      const byEquip = new Map<number, SelectedItem>()
      for (const p of pieces) {
        if (!GAME.equipById[p.equipId]) continue
        const it = byEquip.get(p.equipId) ?? { equipId: p.equipId, copies: [] }
        it.copies.push({ awaken: p.awaken, id: newCopyId() })
        byEquip.set(p.equipId, it)
      }
      this.selected = [...byEquip.values()]
    },
    persist() {
      appStore().save('bag', { selected: this.selected, lockedCells: this.lockedCells, previousLayout: this.previousLayout })
    },
  },
})
