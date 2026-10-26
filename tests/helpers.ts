/** 测试用的小型合成数据，便于手算期望值 */
import type { GameData } from '@/core/data'
import type { AttrDef, AwakenDB, Elder, ElementId, Equip, Placement, Shape, Skill, SolverContext, Tier, WeaponForm } from '@/core/types'

export const ATTRS: AttrDef[] = [
  { id: 2001, name: '攻击力', kind: 1, nPower: 10 },
  { id: 2002, name: '防御', kind: 1, nPower: 10 },
  { id: 2003, name: '生命值', kind: 1, nPower: 0.2 },
  { id: 2004, name: '攻击力百分比', kind: 2, nPower: 0 },
  { id: 2005, name: '防御百分比', kind: 2, nPower: 0 },
  { id: 2006, name: '生命值百分比', kind: 2, nPower: 0 },
  { id: 2025, name: '增伤', kind: 2, nPower: 10 },
]

export const SHAPE_1x1: Shape = { id: 1, name: '1格', cells: [[0, 0]], w: 1, h: 1, cellCount: 1 }
export const SHAPE_1x2: Shape = { id: 2, name: '横2格', cells: [[0, 0], [0, 1]], w: 2, h: 1, cellCount: 2 }

export function mkEquip(p: {
  id: number; name?: string; element?: ElementId; form?: WeaponForm; tier?: Tier
  atk?: number; def?: number; hp?: number; skills?: number[]; shapeId?: number; elderId?: number
}): Equip {
  const tier = p.tier ?? 1
  return {
    id: p.id,
    name: p.name ?? `E${p.id}`,
    element: p.element ?? 1,
    weaponForm: p.form ?? 2,
    tier,
    quality: tier,
    shapeId: p.shapeId ?? 1,
    base: [
      { attr: 2001, value: p.atk ?? 0 },
      { attr: 2002, value: p.def ?? 0 },
      { attr: 2003, value: p.hp ?? 0 },
    ],
    skillIds: p.skills ?? [],
    desc: '',
    elderId: p.elderId,
  }
}

export function mkGame(p: { equips: Equip[]; skills?: Skill[]; awakenDb?: AwakenDB; elders?: Elder[]; shapes?: Shape[] }): GameData {
  const elders = p.elders ?? []
  const shapes = p.shapes ?? [SHAPE_1x1, SHAPE_1x2]
  return {
    attrs: ATTRS,
    attrById: Object.fromEntries(ATTRS.map((a) => [a.id, a])),
    skillById: Object.fromEntries((p.skills ?? []).map((s) => [s.id, s])),
    talents: [],
    talentById: {},
    shapeById: Object.fromEntries(shapes.map((s) => [s.id, s])),
    equips: p.equips,
    equipById: Object.fromEntries(p.equips.map((e) => [e.id, e])),
    elders,
    elderById: Object.fromEntries(elders.map((e) => [e.id, e])),
    elderByRedEquip: Object.fromEntries(elders.map((e) => [e.redEquipId, e])),
    awakenDb: p.awakenDb ?? {},
  }
}

/** 直接按坐标摆放；eff 取基础值 */
export function place(items: { eq: Equip; r: number; c: number; awaken?: number; shape?: Shape }[], C = 7): {
  pl: Placement[]; ctx: SolverContext
} {
  const pl: Placement[] = items.map((it, uid) => {
    const shape = it.shape ?? SHAPE_1x1
    const cells = shape.cells.map(([dr, dc]) => (it.r + dr) * C + (it.c + dc))
    return { inst: { uid, eq: it.eq, tier: it.eq.tier, shape, awaken: it.awaken ?? 0 }, eq: it.eq, tier: it.eq.tier, r: it.r, c: it.c, cells }
  })
  const base = (attr: number) => items.map((it) => it.eq.base.find((b) => b.attr === attr)?.value ?? 0)
  const ctx: SolverContext = {
    R: 6, C, locked: [], effAtk: base(2001), effDef: base(2002), effHp: base(2003),
    target: 'power', weights: null, fillAll: false,
  }
  return { pl, ctx }
}
