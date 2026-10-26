/** 基于真实游戏数据构造求解问题 */
import { GAME } from '@/core/data'
import { buildContext, buildInstances } from '@/core/solver/instances'
import { mulberry32 } from '@/core/solver/rng'
import type { ElderConfig, Instance, Placement, SelectedItem, SolverContext, Target } from '@/core/types'

export interface Problem {
  instances: Instance[]
  ctx: SolverContext
  awakenOf: Record<number, number> // 觉醒版格式（按 equipId 共享）
}

export function realProblem(seed: number, opts: { pieces?: number; fillAll?: boolean; target?: Target; locked?: number[] } = {}): Problem {
  const rng = mulberry32(seed)
  const pick = <T,>(arr: readonly T[]) => arr[(rng() * arr.length) | 0]
  const reds = GAME.elders.filter((e) => GAME.awakenDb[e.redEquipId]).map((e) => GAME.equipById[e.redEquipId])
  const others = GAME.equips.filter((e) => e.tier >= 3 && e.elderId === undefined && e.quality === e.tier)
  const red1 = pick(reds)
  let red2 = pick(reds)
  while (red2.id === red1.id) red2 = pick(reds)
  const awakenOf: Record<number, number> = { [red1.id]: 3, [red2.id]: 5 }
  const selected: SelectedItem[] = [
    { equipId: red1.id, copies: [{ awaken: 3 }] },
    { equipId: red2.id, copies: [{ awaken: 5 }] },
  ]
  for (let i = 0; i < (opts.pieces ?? 10); i++) selected.push({ equipId: pick(others).id, copies: [{ awaken: 0 }] })
  const configs: Record<number, ElderConfig> = Object.fromEntries(
    GAME.elders.map((e) => [e.id, { elderId: e.id, owned: true, star: 5, awakenCap: 5 }]),
  )
  const instances = buildInstances(selected, GAME)
  const ctx = buildContext(instances, {
    elderConfigs: configs, talents: [], target: opts.target ?? 'power', weights: null,
    fillAll: opts.fillAll ?? false, locked: opts.locked ?? [],
  }, GAME)
  return { instances, ctx, awakenOf }
}

/** 摆盘合法性：不越界、不重叠、不占锁格、格子与形状一致 */
export function assertValidLayout(pl: Placement[], ctx: SolverContext): void {
  const seen = new Set<number>()
  const locked = new Set(ctx.locked)
  for (const p of pl) {
    const expected = p.inst.shape.cells.map(([dr, dc]) => (p.r + dr) * ctx.C + (p.c + dc))
    if (JSON.stringify(expected) !== JSON.stringify(p.cells)) throw new Error(`uid ${p.inst.uid} 格子与形状不符`)
    if (p.r < 0 || p.c < 0 || p.r + p.inst.shape.h > ctx.R || p.c + p.inst.shape.w > ctx.C) throw new Error(`uid ${p.inst.uid} 越界`)
    for (const c of p.cells) {
      if (seen.has(c)) throw new Error(`格 ${c} 重叠`)
      if (locked.has(c)) throw new Error(`格 ${c} 是锁格`)
      seen.add(c)
    }
  }
}
