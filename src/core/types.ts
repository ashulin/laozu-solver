/**
 * 领域模型（全员共用的契约）。纯类型 + 少量常量，无运行时依赖。
 * 设计说明见 docs/architecture.md 第 4.1 节。
 */

/* ================================================================
 * 0. 枚举与常量
 * ================================================================ */
export type ElementId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 // 金木水火土雷邪体
export type WeaponForm = 0 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 // 其他/剑乐异御枪刀锤幡
export type Tier = 1 | 2 | 3 | 4 | 5 // 品阶：5红 4黄 3紫 2蓝 1绿

export const ELEMENTS: readonly ElementId[] = [1, 2, 3, 4, 5, 6, 7, 8]
export const FORMS: readonly WeaponForm[] = [2, 3, 4, 5, 6, 7, 8, 9, 0]
export const TIERS: readonly Tier[] = [5, 4, 3, 2, 1]
export const CELL_COUNTS: readonly number[] = [1, 2, 3, 4, 5]

export const ELEMENT_NAME: Record<ElementId, string> = { 1: '金', 2: '木', 3: '水', 4: '火', 5: '土', 6: '雷', 7: '邪', 8: '体' }
export const FORM_NAME: Record<WeaponForm, string> = { 0: '其他', 2: '剑', 3: '乐', 4: '异', 5: '御', 6: '枪', 7: '刀', 8: '锤', 9: '幡' }
export const TIER_NAME: Record<Tier, string> = { 1: '一阶', 2: '二阶', 3: '三阶', 4: '四阶', 5: '五阶' }

/** 长老品级（游戏内术语）：4 优品 / 3 良品 / 2 凡品 */
export type ElderQuality = 2 | 3 | 4
export const ELDER_QUALITIES: readonly ElderQuality[] = [4, 3, 2]
export const ELDER_QUALITY_NAME: Record<ElderQuality, string> = { 4: '优品', 3: '良品', 2: '凡品' }

export const ROWS = 6
export const COLS = 7

/* ================================================================
 * 1. 静态游戏数据
 * ================================================================ */
export interface Equip {
  id: number // 已含阶：同族各阶是不同 id
  name: string
  element: ElementId
  weaponForm: WeaponForm
  tier: Tier
  quality: number // 源数据原样保留；显示/筛选用 tier
  shapeId: number
  base: { attr: number; value: number }[]
  skillIds: number[]
  desc: string
  elderId?: number // 派生的反向引用：仅绑定长老的红装有
}

export interface Shape {
  id: number
  name: string
  cells: [number, number][] // [dr, dc]，锚点为左上
  w: number
  h: number
  cellCount: number
}

export interface Skill {
  id: number
  name: string
  scope: 'self' | 'adjacent'
  mask: number // 元素位掩码：1 << element
  buffs: { attr: number; value: number }[]
  desc: string
}

export interface Talent {
  id: number
  name: string
  form: WeaponForm
  attr: number // 百分比属性 2004/2005/2006
  value: number // /10000
  desc: string
}

export interface AttrDef {
  id: number
  name: string
  kind: 1 | 2 // 1 固定值 2 百分比
  nPower: number // 战力系数
}

export type AwakenEffect =
  | { type: 'self_per_adjacent'; element: ElementId; attr: number; perUnit: number }
  | { type: 'self_mult'; pct: number }
  | { type: 'adjacent_buff'; element: ElementId; pct: number }
  | { type: 'global_form'; form: WeaponForm; pct: number; excludeSelf?: boolean }
  | { type: 'global_element'; element: ElementId; pct: number; excludeSelf?: boolean }

export interface AwakenEntry {
  maxLevel: number
  levels: Record<number, AwakenEffect[]> // 向下累积：N 级 = 1..N 全生效
}

export type AwakenDB = Record<number, AwakenEntry> // key: equipId；无条目 = 觉醒数据缺失

/* ================================================================
 * 2. 长老
 * ================================================================ */
export interface Elder {
  id: number
  name: string
  alias?: string // 摆盘等窄空间的显示简称（由玩家指定）
  quality: ElderQuality // 品级：4优品 3良品 2凡品
  redEquipId: number
  starBonus: [number, number][] // [星级阈值, 基础三围加成 /10000]
}

export interface ElderConfig {
  elderId: number
  owned: boolean // 默认账号默认拥有全部长老
  star: number // 0~5
  awakenCap: number // 长老觉醒等级 0~maxLevel；即绑定红装每份副本可觉醒到的上限（字段名沿用，兼容已有存储与备份）
}

/* ================================================================
 * 3. 背包
 * ================================================================ */
export interface EquipCopy {
  awaken: number // 0~cap；非红装恒为 0
  /** 副本身份：老数据没有该字段，读取时按下标补齐 */
  id?: string
}

export interface SelectedItem {
  equipId: number
  copies: EquipCopy[]
}

export interface Instance {
  uid: number // 一次求解内唯一，等于数组下标
  eq: Equip
  tier: Tier
  shape: Shape
  awaken: number
}

/* ================================================================
 * 4. 求解
 * ================================================================ */
export type Target = 'power' | 'weighted'

export interface SolverContext {
  R: number
  C: number
  locked: number[]
  effAtk: number[] // 按 uid：已含星级+天赋、觉醒 self_mult
  effDef: number[]
  effHp: number[]
  target: Target
  weights: Record<number, number> | null
  fillAll: boolean
}

/** evaluate 需要的静态数据（随 job 传入 Worker，避免 Worker 打包整套数据库） */
export interface ScoringData {
  skillById: Record<number, Skill>
  awakenDb: AwakenDB
  attrs: AttrDef[]
}

export interface Placement {
  inst: Instance
  eq: Equip
  tier: Tier
  r: number
  c: number
  cells: number[]
}

export interface Snapshot {
  uid: number
  r: number
  c: number
}

export interface BuffSource {
  t: 'self' | 'neighbor' | 'awakenSelf' | 'awakenAdj' | 'awakenGlobal'
  skill: string
  attr: number | null // null：觉醒相邻/全局直接加攻防血
  value: number
  per?: number
  n?: number
  names?: string[]
  from?: string
}

export interface EvaluatedPiece {
  uid: number
  eq: Equip
  tier: Tier
  awaken: number
  atk: number
  def: number
  hp: number
  buffs: [number, number][]
  srcs: BuffSource[]
  power: number
  weighted: number
}

export interface Evaluation {
  powerTotal: number
  weightedTotal: number
  pieces: EvaluatedPiece[]
}

export interface Milestone {
  elapsedMs: number
  score: number
  filledCells: number
  snap: Snapshot[]
  workerId: number
  reason: 'new-best' | 'fill-up'
}

export interface SolveResult {
  score: number // 真实分（已扣除 FILL_BONUS）
  evaluation: Evaluation
  layout: Snapshot[]
  placedCount: number
  instanceCount: number
  filledCells: number
  usableCells: number
  iterations: number
  elapsedMs: number
  seed: number
  stopped: boolean
}

/* ================================================================
 * 6. UI 支撑
 * ================================================================ */
export type BoardMode = 'edit' | 'layout' | 'current' | 'saved'

export interface CatalogFilters {
  elements: ElementId[]
  forms: WeaponForm[]
  cellCounts: number[]
  tiers: Tier[]
  keyword: string
}

export interface SavedPiece {
  equipId: number
  awaken: number
  r: number
  c: number
}

export interface SavedBoard {
  name: string
  pieces: SavedPiece[]
  score: number
  target: Target
  savedAt: number
  dataVersion: string
}

/* ================================================================
 * 7. 持久化信封
 * ================================================================ */
export interface Persisted<T> {
  v: number
  data: T
}
