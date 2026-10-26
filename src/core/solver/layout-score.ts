/**
 * 任意摆盘（之前摆盘 / 收藏摆盘）重新计分，用于和实时摆盘做得分对比。
 * 每个 SavedPiece 视为一份副本；越界、重叠、压锁格的件不计入并报告。
 */
import type { GameData } from '../data'
import { scoringData } from '../data'
import type { Evaluation, Instance, Placement, SavedPiece, Snapshot, Target } from '../types'
import { evaluate, objective } from './evaluate'
import { buildContext, type ContextInput } from './instances'

export interface LayoutScore {
  score: number
  evaluation: Evaluation
  placements: Placement[]
  invalid: SavedPiece[]
}

export function scoreLayout(pieces: SavedPiece[], input: ContextInput, game: GameData): LayoutScore {
  const R = input.R ?? 6
  const C = input.C ?? 7
  const locked = new Set(input.locked)
  const occ = new Set<number>()
  const instances: Instance[] = []
  const cellsOf: number[][] = []
  const kept: SavedPiece[] = []
  const invalid: SavedPiece[] = []
  for (const p of pieces) {
    const eq = game.equipById[p.equipId]
    const shape = eq && game.shapeById[eq.shapeId]
    if (!eq || !shape || p.r < 0 || p.c < 0 || p.r + shape.h > R || p.c + shape.w > C) {
      invalid.push(p)
      continue
    }
    const cells = shape.cells.map(([dr, dc]) => (p.r + dr) * C + (p.c + dc))
    if (cells.some((x) => occ.has(x) || locked.has(x))) {
      invalid.push(p)
      continue
    }
    cells.forEach((x) => occ.add(x))
    const maxLv = eq.elderId !== undefined ? (game.awakenDb[eq.id]?.maxLevel ?? 0) : 0
    instances.push({ uid: instances.length, eq, tier: eq.tier, shape, awaken: Math.max(0, Math.min(maxLv, p.awaken)) })
    cellsOf.push(cells)
    kept.push(p)
  }
  const ctx = buildContext(instances, { ...input, R, C }, game)
  const placements: Placement[] = instances.map((inst, i) => ({
    inst, eq: inst.eq, tier: inst.tier, r: kept[i].r, c: kept[i].c, cells: cellsOf[i],
  }))
  const evaluation = evaluate(placements, ctx, scoringData(game), true)
  return { score: objective(evaluation, input.target as Target), evaluation, placements, invalid }
}

/** 求解结果（实例 + 快照）→ 可持久化的 SavedPiece[] */
export function toSavedPieces(instances: Instance[], snap: Snapshot[]): SavedPiece[] {
  const byUid = new Map(instances.map((i) => [i.uid, i]))
  return snap.flatMap((s) => {
    const inst = byUid.get(s.uid)
    return inst ? [{ equipId: inst.eq.id, awaken: inst.awaken, r: s.r, c: s.c }] : []
  })
}
