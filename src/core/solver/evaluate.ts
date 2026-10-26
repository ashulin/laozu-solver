import type { BuffSource, EvaluatedPiece, Evaluation, Placement, ScoringData, SolverContext, Target } from '../types'
import { A_ATK, A_ATKP, A_DEF, A_DEFP, A_HP, A_HPP, DE } from './constants'

const D4: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]]

/** 每件法宝的相邻件下标（4 邻接，按格计算） */
export function neighborsOf(pl: Placement[], R: number, C: number): number[][] {
  const cmap = new Map<number, number>()
  pl.forEach((p, i) => p.cells.forEach((c) => cmap.set(c, i)))
  const neigh = Array.from({ length: pl.length }, () => new Set<number>())
  pl.forEach((p, i) => {
    for (const cell of p.cells) {
      const r = (cell / C) | 0
      const c = cell % C
      for (const [dr, dc] of D4) {
        const nr = r + dr
        const nc = c + dc
        if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue
        const j = cmap.get(nr * C + nc)
        if (j !== undefined && j !== i) {
          neigh[i].add(j)
          neigh[j].add(i)
        }
      }
    }
  })
  return neigh.map((s) => [...s])
}

/**
 * 计分（逐行对齐觉醒版 evaluate，运算顺序保持一致以便对拍）。
 * 唯一差异：觉醒等级按副本取（placement.inst.awaken），而不是按 equipId 共享。
 *
 * 计分顺序：
 *  ① self 技能：相邻指定系件数 × buff
 *  ② 觉醒 self_per_adjacent（1 级）：相邻指定系件数 × perUnit
 *  ③ 相邻件的 adjacent 技能
 *  → 得出每件攻防血与战力
 *  ④ 觉醒 adjacent_buff（≥3 级，取已解锁最高档）：给相邻指定系加攻防血
 *  ⑤ 觉醒 global_form / global_element（≥3 级）：给背包内其他指定形态/系加攻防血
 */
export function evaluate(pl: Placement[], ctx: SolverContext, data: ScoringData, detail = false): Evaluation {
  const P = pl.length
  const nb = neighborsOf(pl, ctx.R, ctx.C)
  const { skillById, awakenDb, attrs } = data
  const weightOf = (id: number, nPower: number) => (ctx.weights ? (ctx.weights[id] ?? nPower) : nPower)
  let powerTotal = 0
  let weightedTotal = 0
  const pieces: EvaluatedPiece[] = []

  for (let h = 0; h < P; h++) {
    const eq = pl[h].eq
    const y = new Map<number, number>()
    const srcs: BuffSource[] = []
    const add = (k: number, v: number) => y.set(k, (y.get(k) ?? 0) + v)

    for (const sid of eq.skillIds) {
      const sk = skillById[sid]
      if (!sk || sk.scope !== 'self') continue
      const T = nb[h].filter((p) => ((1 << pl[p].eq.element) & sk.mask) !== 0)
      if (!T.length) continue
      for (const bf of sk.buffs) {
        const F = bf.value * T.length
        add(bf.attr, F)
        if (detail) srcs.push({ t: 'self', skill: sk.name, attr: bf.attr, value: F, per: bf.value, n: T.length, names: T.map((p) => pl[p].eq.name) })
      }
    }

    const awLv = pl[h].inst.awaken
    const awData = awakenDb[eq.id]
    if (awData && awLv >= 1 && awData.levels[1]) {
      for (const ef of awData.levels[1]) {
        if (ef.type !== 'self_per_adjacent') continue
        const T = nb[h].filter((p) => pl[p].eq.element === ef.element)
        if (!T.length) continue
        const F = ef.perUnit * T.length
        add(ef.attr, F)
        if (detail) srcs.push({ t: 'awakenSelf', skill: '觉醒1', attr: ef.attr, value: F, per: ef.perUnit, n: T.length, names: T.map((p) => pl[p].eq.name) })
      }
    }

    for (const p of nb[h]) {
      const neq = pl[p].eq
      for (const sid of neq.skillIds) {
        const sk = skillById[sid]
        if (!sk || sk.scope !== 'adjacent') continue
        if (((1 << eq.element) & sk.mask) === 0) continue
        for (const bf of sk.buffs) {
          add(bf.attr, bf.value)
          if (detail) srcs.push({ t: 'neighbor', skill: sk.name, attr: bf.attr, value: bf.value, from: `${neq.name}·${pl[p].tier}阶` })
        }
      }
    }

    const uid = pl[h].inst.uid
    const D = ctx.effAtk[uid] * (1 + (y.get(A_ATKP) ?? 0) / DE)
    const Df = ctx.effDef[uid] * (1 + (y.get(A_DEFP) ?? 0) / DE)
    const Hp = ctx.effHp[uid] * (1 + (y.get(A_HPP) ?? 0) / DE)
    const g = (k: number) => (k === A_ATK ? D : k === A_DEF ? Df : k === A_HP ? Hp : (y.get(k) ?? 0))
    let w = 0
    let q = 0
    for (const a of attrs) {
      const u = a.kind === 2 ? 0.01 : 1
      const gv = g(a.id)
      w += gv * u * a.nPower
      q += gv * u * weightOf(a.id, a.nPower)
    }
    powerTotal += w
    weightedTotal += q
    pieces.push({ uid, eq, tier: pl[h].tier, awaken: awLv, atk: D, def: Df, hp: Hp, buffs: [...y.entries()], srcs, power: w, weighted: q })
  }

  /** 给第 p 件加「基础三围 × mult」的攻防血（觉醒相邻/全局共用） */
  const boost = (p: number, mult: number): [number, number] => {
    const pc = pieces[p]
    const u = pl[p].inst.uid
    const dA = Math.floor(ctx.effAtk[u] * mult)
    const dD = Math.floor(ctx.effDef[u] * mult)
    const dH = Math.floor(ctx.effHp[u] * mult)
    pc.atk += dA
    pc.def += dD
    pc.hp += dH
    let dw = 0
    let dq = 0
    for (const a of attrs) {
      const unit = a.kind === 2 ? 0.01 : 1
      let gv = 0
      if (a.id === A_ATK) gv = dA
      else if (a.id === A_DEF) gv = dD
      else if (a.id === A_HP) gv = dH
      else continue
      dw += gv * unit * a.nPower
      dq += gv * unit * weightOf(a.id, a.nPower)
    }
    pc.power += dw
    pc.weighted += dq
    return [dw, dq]
  }

  for (let h = 0; h < P; h++) {
    const eq = pl[h].eq
    const awLv = pl[h].inst.awaken
    const awData = awakenDb[eq.id]
    if (!awData || awLv < 3) continue
    let adjEf: { element: number; pct: number } | null = null
    let adjLv = 0
    for (let lv = 3; lv <= awLv; lv++) {
      for (const ef of awData.levels[lv] ?? []) {
        if (ef.type === 'adjacent_buff') {
          adjEf = ef
          adjLv = lv
        }
      }
    }
    if (!adjEf) continue
    const mult = adjEf.pct / DE
    for (const p of nb[h]) {
      if (pl[p].eq.element !== adjEf.element) continue
      const [dw, dq] = boost(p, mult)
      powerTotal += dw
      weightedTotal += dq
      if (detail) pieces[p].srcs.push({ t: 'awakenAdj', skill: `觉醒${adjLv}(来自${eq.name})`, attr: null, value: adjEf.pct, per: adjEf.pct, n: 1, names: [], from: eq.name })
    }
  }

  for (let h = 0; h < P; h++) {
    const eq = pl[h].eq
    const awLv = pl[h].inst.awaken
    const awData = awakenDb[eq.id]
    if (!awData || awLv < 3) continue
    for (let lv = 3; lv <= awLv; lv++) {
      for (const ef of awData.levels[lv] ?? []) {
        if (ef.type !== 'global_form' && ef.type !== 'global_element') continue
        const mult = ef.pct / DE
        for (let p = 0; p < P; p++) {
          if (p === h) continue
          const peq = pl[p].eq
          if (ef.type === 'global_form' ? peq.weaponForm !== ef.form : peq.element !== ef.element) continue
          const [dw, dq] = boost(p, mult)
          powerTotal += dw
          weightedTotal += dq
          if (detail) pieces[p].srcs.push({ t: 'awakenGlobal', skill: `觉醒${lv}(来自${eq.name})`, attr: null, value: ef.pct, per: ef.pct, n: 1, names: [], from: eq.name })
        }
      }
    }
  }

  return { powerTotal, weightedTotal, pieces }
}

export const objective = (r: Evaluation, target: Target): number => (target === 'weighted' ? r.weightedTotal : r.powerTotal)
