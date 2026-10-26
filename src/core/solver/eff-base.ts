import type { AwakenDB, Elder, Equip, Talent } from '../types'
import { DE, PCT_TO_BASE } from './constants'

/** 弟子天赋 → { 武器形态: { 基础属性: 加成/10000 } }。同一天赋重复选择只算一次。 */
export type TalentMap = Record<number, Record<number, number>>

export function buildTalentMap(ids: (number | null | undefined)[], talentById: Record<number, Talent>): TalentMap {
  const m: TalentMap = {}
  const seen = new Set<number>()
  for (const id of ids) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    const t = talentById[id]
    if (!t) continue
    const baseAttr = PCT_TO_BASE[t.attr]
    if (!baseAttr) continue
    const byForm = (m[t.form] ??= {})
    byForm[baseAttr] = (byForm[baseAttr] ?? 0) + t.value
  }
  return m
}

/** 星级加成：取「阈值 ≤ 当前星级」的最高档 */
export function starBonusOf(elder: Elder | undefined, star: number): number {
  if (!elder || star <= 0) return 0
  let s = 0
  for (const [threshold, value] of elder.starBonus) if (threshold <= star) s = value
  return s
}

/** 觉醒 self_mult 合计：1..awaken 级累积 */
export function awakenSelfMult(awakenDb: AwakenDB, equipId: number, awaken: number): number {
  const entry = awakenDb[equipId]
  if (!entry || awaken <= 0) return 0
  let sum = 0
  for (let lv = 1; lv <= Math.min(awaken, entry.maxLevel); lv++) {
    for (const ef of entry.levels[lv] ?? []) if (ef.type === 'self_mult') sum += ef.pct
  }
  return sum
}

export interface EffBaseInput {
  elder?: Elder // 该法宝绑定的长老（非红装为 undefined）
  star: number // 长老星级
  awaken: number // 该副本的觉醒等级
  talentMap: TalentMap
  awakenDb: AwakenDB
}

/**
 * 一份法宝副本的某项基础属性有效值。
 * 公式（对齐觉醒版）：基础值 × (1 + 星级 + 天赋) × (1 + 觉醒self_mult)，向下取整，且不低于基础值。
 * 星级只对品质 5 且绑定长老的红装生效。
 */
export function effBase(eq: Equip, attr: number, input: EffBaseInput): number {
  const bv = eq.base.find((b) => b.attr === attr)?.value ?? 0
  let o = 0
  if (eq.quality === 5 && input.elder) o += starBonusOf(input.elder, input.star) / DE
  o += (input.talentMap[eq.weaponForm]?.[attr] ?? 0) / DE
  const aw = awakenSelfMult(input.awakenDb, eq.id, input.awaken) / DE
  const v = bv * (1 + o) * (1 + aw)
  return v > bv ? Math.floor(v) : bv
}
