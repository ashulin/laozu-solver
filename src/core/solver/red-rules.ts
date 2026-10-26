import type { GameData } from '../data'
import type { ElderConfig, SelectedItem } from '../types'

/** 单局最多选 2 位长老 → 背包红装最多 2 种 */
export const MAX_RED_KINDS = 2

/** 红装可携带数量（已实证）：未拥有 0，拥有 1，3 星起 2 */
export function maxRedCopies(cfg: ElderConfig | undefined): number {
  if (!cfg || !cfg.owned) return 0
  return cfg.star >= 3 ? 2 : 1
}

/** 长老觉醒上限的合法范围：0 ~ 该红装 maxLevel（无觉醒数据为 0） */
export function maxAwakenCap(game: GameData, elderId: number): number {
  const elder = game.elderById[elderId]
  return elder ? (game.awakenDb[elder.redEquipId]?.maxLevel ?? 0) : 0
}

export interface RedItem {
  equipId: number
  awakens: number[] // 每份副本的觉醒等级，长度即数量
}

export function redItemsOf(selected: SelectedItem[]): RedItem[] {
  return selected.map((s) => ({ equipId: s.equipId, awakens: s.copies.map((c) => c.awaken) }))
}

/**
 * 红装校验，返回给用户看的提示（空数组 = 通过）。
 * 规则：种类 ≤ 2；长老须已拥有；份数 ≤ maxRedCopies；每份觉醒 ≤ 长老觉醒上限。
 */
export function checkRedEquips(items: RedItem[], configs: Record<number, ElderConfig>, game: GameData): string[] {
  const warnings: string[] = []
  const byEquip = new Map<number, number[]>()
  for (const it of items) {
    const eq = game.equipById[it.equipId]
    if (!eq || eq.elderId === undefined || it.awakens.length === 0) continue
    byEquip.set(it.equipId, [...(byEquip.get(it.equipId) ?? []), ...it.awakens])
  }
  if (byEquip.size > MAX_RED_KINDS) {
    warnings.push(`红装共 ${byEquip.size} 种，单局最多选 ${MAX_RED_KINDS} 位长老（最多 ${MAX_RED_KINDS} 种红装）`)
  }
  for (const [equipId, awakens] of byEquip) {
    const eq = game.equipById[equipId]
    const elder = game.elderById[eq.elderId!]
    const cfg = configs[elder.id]
    if (!cfg?.owned) {
      warnings.push(`${eq.name}：长老「${elder.name}」未标记为已拥有`)
      continue
    }
    const max = maxRedCopies(cfg)
    if (awakens.length > max) {
      warnings.push(`${eq.name} ×${awakens.length}：长老「${elder.name}」${cfg.star} 星最多带 ${max} 件（3 星起可带 2 件）`)
    }
    const over = awakens.filter((a) => a > cfg.awakenCap)
    if (over.length) {
      warnings.push(`${eq.name}：觉醒 ${Math.max(...over)} 超过长老「${elder.name}」的觉醒上限 ${cfg.awakenCap}`)
    }
  }
  return warnings
}
