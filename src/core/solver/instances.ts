import type { GameData } from '../data'
import { COLS, ROWS } from '../types'
import type { ElderConfig, Instance, SelectedItem, SolverContext, Target } from '../types'
import { A_ATK, A_DEF, A_HP } from './constants'
import { buildTalentMap, effBase } from './eff-base'

/** 已选列表 → 求解实例（每份副本一个实例，uid = 下标）。觉醒等级截断到 0~maxLevel，非红装恒为 0。 */
export function buildInstances(selected: SelectedItem[], game: GameData): Instance[] {
  const out: Instance[] = []
  for (const item of selected) {
    const eq = game.equipById[item.equipId]
    if (!eq) continue
    const shape = game.shapeById[eq.shapeId]
    const maxLv = eq.elderId !== undefined ? (game.awakenDb[eq.id]?.maxLevel ?? 0) : 0
    for (const copy of item.copies) {
      const awaken = Math.max(0, Math.min(maxLv, Math.floor(copy.awaken || 0)))
      out.push({ uid: out.length, eq, tier: eq.tier, shape, awaken })
    }
  }
  return out
}

export interface ContextInput {
  elderConfigs: Record<number, ElderConfig>
  talents: (number | null)[]
  target: Target
  weights: Record<number, number> | null // 用户自定义权重（可缺项，缺项取 nPower）
  fillAll: boolean
  locked: number[]
  R?: number
  C?: number
}

/** 构建求解上下文：主线程按副本预计算有效三围（星级+天赋 × 觉醒 self_mult） */
export function buildContext(instances: Instance[], input: ContextInput, game: GameData): SolverContext {
  const talentMap = buildTalentMap(input.talents, game.talentById)
  const eff = (attr: number) =>
    instances.map((inst) => {
      const elder = inst.eq.elderId !== undefined ? game.elderById[inst.eq.elderId] : undefined
      const star = elder ? (input.elderConfigs[elder.id]?.star ?? 0) : 0
      return effBase(inst.eq, attr, { elder, star, awaken: inst.awaken, talentMap, awakenDb: game.awakenDb })
    })
  const weights = input.target === 'weighted'
    ? Object.fromEntries(game.attrs.map((a) => [a.id, input.weights?.[a.id] ?? a.nPower]))
    : null
  return {
    R: input.R ?? ROWS,
    C: input.C ?? COLS,
    locked: [...input.locked],
    effAtk: eff(A_ATK),
    effDef: eff(A_DEF),
    effHp: eff(A_HP),
    target: input.target,
    weights,
    fillAll: input.fillAll,
  }
}
