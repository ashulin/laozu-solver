/**
 * 游戏数据层：把 raw/*.json（觉醒版原始元组格式）转成带类型的对象并构建索引。
 * raw 文件由 scripts/extract-data.mjs 生成，勿手改。
 */
import rawDbJson from './raw/game-db.json'
import rawElderMapJson from './raw/elder-map.json'
import rawAwakenJson from './raw/awaken-db.json'
import type {
  AttrDef, AwakenDB, Elder, ElementId, Equip, ScoringData, Shape, Skill, Talent, Tier, WeaponForm,
} from '../types'

/* ---------------- 原始格式 ---------------- */
type RawPair = [number, number]
export interface RawGameDb {
  attrs: [number, string, number, number][] // id,name,kind,nPower
  talents: [number, string, number, number, number, string][] // id,name,form,attr,value,desc
  skills: [number, string, string, number, RawPair[], string][] // id,name,scope,mask,buffs,desc
  shapes: Record<string, [string, RawPair[], number, number]> // name,cells,w,h
  equips: [number, string, number, number, number, number, number, RawPair[], number[], string, RawPair[] | null][]
  // id,name,element,tier,quality,weaponForm,shapeId,base,skillIds,desc,starBonus
}
export type RawElderMap = Record<string, { id: number; name: string; quality: number; starBonus: RawPair[] }>
export type RawAwakenDb = Record<string, { maxLevel: number; levels: Record<string, unknown[]> }>

/* ---------------- 构建 ---------------- */
export interface GameData {
  attrs: AttrDef[]
  attrById: Record<number, AttrDef>
  skillById: Record<number, Skill>
  talents: Talent[]
  talentById: Record<number, Talent>
  shapeById: Record<number, Shape>
  equips: Equip[]
  equipById: Record<number, Equip>
  elders: Elder[]
  elderById: Record<number, Elder>
  elderByRedEquip: Record<number, Elder>
  awakenDb: AwakenDB
}

export function buildGameData(db: RawGameDb, elderMap: RawElderMap, awaken: RawAwakenDb): GameData {
  const attrs: AttrDef[] = db.attrs.map(([id, name, kind, nPower]) => ({ id, name, kind: kind as 1 | 2, nPower }))
  const skillById: Record<number, Skill> = {}
  for (const [id, name, scope, mask, buffs, desc] of db.skills) {
    skillById[id] = { id, name, scope: scope as Skill['scope'], mask, buffs: buffs.map(([attr, value]) => ({ attr, value })), desc }
  }
  const talents: Talent[] = db.talents.map(([id, name, form, attr, value, desc]) => ({
    id, name, form: form as WeaponForm, attr, value, desc,
  }))
  const shapeById: Record<number, Shape> = {}
  for (const [id, [name, cells, w, h]] of Object.entries(db.shapes)) {
    shapeById[+id] = { id: +id, name, cells, w, h, cellCount: cells.length }
  }

  const elders: Elder[] = Object.entries(elderMap).map(([equipId, e]) => ({
    id: e.id,
    name: e.name,
    quality: e.quality as Elder['quality'],
    redEquipId: +equipId,
    starBonus: e.starBonus,
  }))
  const elderByRedEquip: Record<number, Elder> = {}
  for (const e of elders) elderByRedEquip[e.redEquipId] = e

  const equips: Equip[] = db.equips.map(
    ([id, name, element, tier, quality, weaponForm, shapeId, base, skillIds, desc]) => {
      const eq: Equip = {
        id, name,
        element: element as ElementId,
        weaponForm: weaponForm as WeaponForm,
        tier: tier as Tier,
        quality,
        shapeId,
        base: base.map(([attr, value]) => ({ attr, value })),
        skillIds,
        desc: desc.replace(/\\n/g, '\n'),
      }
      const elder = elderByRedEquip[id]
      if (elder) eq.elderId = elder.id
      return eq
    },
  )

  return {
    attrs,
    attrById: Object.fromEntries(attrs.map((a) => [a.id, a])),
    skillById,
    talents,
    talentById: Object.fromEntries(talents.map((t) => [t.id, t])),
    shapeById,
    equips,
    equipById: Object.fromEntries(equips.map((e) => [e.id, e])),
    elders,
    elderById: Object.fromEntries(elders.map((e) => [e.id, e])),
    elderByRedEquip,
    awakenDb: awaken as unknown as AwakenDB,
  }
}

export const GAME: GameData = buildGameData(
  rawDbJson as unknown as RawGameDb,
  rawElderMapJson as unknown as RawElderMap,
  rawAwakenJson as unknown as RawAwakenDb,
)

export function scoringData(game: GameData = GAME): ScoringData {
  return { skillById: game.skillById, awakenDb: game.awakenDb, attrs: game.attrs }
}

/** 普通法宝（非占位）：排除灵肘/默认格子这类 quality 与 tier 不一致的测试占位条目 */
export function isPlayableEquip(eq: Equip): boolean {
  return eq.quality === eq.tier
}
