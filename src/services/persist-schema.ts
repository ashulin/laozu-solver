/**
 * 持久化数据的结构定义与校验（导入备份时使用）。
 * 原则：只信任通过校验的字段；逐字段重建对象，未知字段丢弃；任何一处非法则整段拒绝。
 */
import type { GameData } from '@/core/data'
import { MAX_SAMPLES, MAX_SAMPLES_PER_EQUIP, isValidSample, type OcrSample, type OcrSamplesData } from '@/core/ocr/learn'
import { maxAwakenCap } from '@/core/solver/red-rules'
import { WORKER_CHOICES } from '@/core/solver/temperature'
import { CELL_COUNTS, COLS, ELEMENTS, FORMS, ROWS, TIERS } from '@/core/types'
import type { CatalogFilters, ElderConfig, SavedBoard, SavedPiece, SelectedItem, Target } from '@/core/types'

export const BUDGET_CHOICES = [8, 15, 30, 60, 120] as const
export const MAX_COPIES_PER_ITEM = 42

export interface BagData {
  selected: SelectedItem[]
  lockedCells: number[]
  previousLayout: SavedPiece[] | null // 截图导入时记录的游戏内原摆法（「之前摆盘」）
}

export interface SettingsData {
  target: Target
  weights: Record<number, number>
  talents: (number | null)[] // 弟子天赋 4 格
  budgetSec: number
  threads: 'auto' | number
  seed: number
  fillAll: boolean
  catalogFilters: CatalogFilters
}

export type EldersData = ElderConfig[]

export const defaultFilters = (): CatalogFilters => ({ elements: [], forms: [], cellCounts: [], tiers: [], keyword: '' })
export const defaultSettings = (): SettingsData => ({
  target: 'power', weights: {}, talents: [null, null, null, null], budgetSec: 15, threads: 'auto',
  seed: 42, fillAll: true, catalogFilters: defaultFilters(),
})
export const defaultBag = (): BagData => ({ selected: [], lockedCells: [], previousLayout: null })

/* ---------------- 基础校验工具 ---------------- */
export class ValidationError extends Error {}
const fail = (path: string, why: string): never => {
  throw new ValidationError(`${path}：${why}`)
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const int = (v: unknown, path: string, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) fail(path, `应为 ${min}~${max} 的整数`)
  return v as number
}
const bool = (v: unknown, path: string): boolean => {
  if (typeof v !== 'boolean') fail(path, '应为 true/false')
  return v as boolean
}
const arr = (v: unknown, path: string, maxLen: number): unknown[] => {
  if (!Array.isArray(v)) fail(path, '应为数组')
  if ((v as unknown[]).length > maxLen) fail(path, `长度不能超过 ${maxLen}`)
  return v as unknown[]
}
const oneOf = <T>(v: unknown, path: string, choices: readonly T[]): T => {
  if (!choices.includes(v as T)) fail(path, `取值应为 ${choices.join(' / ')}`)
  return v as T
}
const subsetOf = <T>(v: unknown, path: string, choices: readonly T[]): T[] =>
  [...new Set(arr(v, path, choices.length).map((x, i) => oneOf(x, `${path}[${i}]`, choices)))]

/* ---------------- 各段校验 ---------------- */
export function validateElders(v: unknown, game: GameData): EldersData {
  const list = arr(v, 'elders', game.elders.length)
  const seen = new Set<number>()
  return list.map((raw, i) => {
    const p = `elders[${i}]`
    if (!isObj(raw)) fail(p, '应为对象')
    const r = raw as Record<string, unknown>
    const elderId = int(r.elderId, `${p}.elderId`, 0, Number.MAX_SAFE_INTEGER)
    if (!game.elderById[elderId]) fail(`${p}.elderId`, `长老 ${elderId} 不存在`)
    if (seen.has(elderId)) fail(`${p}.elderId`, `长老 ${elderId} 重复`)
    seen.add(elderId)
    return {
      elderId,
      owned: bool(r.owned, `${p}.owned`),
      star: int(r.star, `${p}.star`, 0, 5),
      awakenCap: int(r.awakenCap, `${p}.awakenCap`, 0, maxAwakenCap(game, elderId)),
    }
  })
}

const CELL_MAX = ROWS * COLS - 1

function validatePieces(v: unknown, path: string, game: GameData): SavedPiece[] {
  return arr(v, path, ROWS * COLS).map((raw, i) => {
    const p = `${path}[${i}]`
    if (!isObj(raw)) fail(p, '应为对象')
    const r = raw as Record<string, unknown>
    const equipId = int(r.equipId, `${p}.equipId`, 0, Number.MAX_SAFE_INTEGER)
    if (!game.equipById[equipId]) fail(`${p}.equipId`, `法宝 ${equipId} 不存在`)
    return {
      equipId,
      awaken: int(r.awaken, `${p}.awaken`, 0, 5),
      r: int(r.r, `${p}.r`, 0, ROWS - 1),
      c: int(r.c, `${p}.c`, 0, COLS - 1),
    }
  })
}

export function validateBag(v: unknown, game: GameData): BagData {
  if (!isObj(v)) fail('bag', '应为对象')
  const r = v as Record<string, unknown>
  const selected = arr(r.selected, 'bag.selected', 500).map((raw, i) => {
    const p = `bag.selected[${i}]`
    if (!isObj(raw)) fail(p, '应为对象')
    const s = raw as Record<string, unknown>
    const equipId = int(s.equipId, `${p}.equipId`, 0, Number.MAX_SAFE_INTEGER)
    if (!game.equipById[equipId]) fail(`${p}.equipId`, `法宝 ${equipId} 不存在`)
    const copies = arr(s.copies, `${p}.copies`, MAX_COPIES_PER_ITEM).map((c, j) => {
      if (!isObj(c)) fail(`${p}.copies[${j}]`, '应为对象')
      return { awaken: int((c as Record<string, unknown>).awaken, `${p}.copies[${j}].awaken`, 0, 5) }
    })
    if (!copies.length) fail(`${p}.copies`, '至少 1 份')
    return { equipId, copies }
  })
  const lockedCells = [...new Set(arr(r.lockedCells, 'bag.lockedCells', ROWS * COLS).map((c, i) => int(c, `bag.lockedCells[${i}]`, 0, CELL_MAX)))]
  const previousLayout = r.previousLayout === null || r.previousLayout === undefined
    ? null
    : validatePieces(r.previousLayout, 'bag.previousLayout', game)
  return { selected, lockedCells, previousLayout }
}

export function validateFilters(v: unknown): CatalogFilters {
  if (!isObj(v)) fail('catalogFilters', '应为对象')
  const r = v as Record<string, unknown>
  if (typeof r.keyword !== 'string' || r.keyword.length > 40) fail('catalogFilters.keyword', '应为不超过 40 字的字符串')
  return {
    elements: subsetOf(r.elements, 'catalogFilters.elements', ELEMENTS),
    forms: subsetOf(r.forms, 'catalogFilters.forms', FORMS),
    cellCounts: subsetOf(r.cellCounts, 'catalogFilters.cellCounts', CELL_COUNTS),
    tiers: subsetOf(r.tiers, 'catalogFilters.tiers', TIERS),
    keyword: r.keyword as string,
  }
}

export function validateSettings(v: unknown, game: GameData): SettingsData {
  if (!isObj(v)) fail('settings', '应为对象')
  const r = v as Record<string, unknown>
  if (!isObj(r.weights)) fail('settings.weights', '应为对象')
  const weights: Record<number, number> = {}
  for (const [k, w] of Object.entries(r.weights as Record<string, unknown>)) {
    if (!game.attrById[+k]) fail(`settings.weights.${k}`, '属性不存在')
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0 || w > 1e6) fail(`settings.weights.${k}`, '应为 0~1000000 的数')
    weights[+k] = w as number
  }
  const talents = arr(r.talents, 'settings.talents', 4).map((t, i) => {
    if (t === null) return null
    const id = int(t, `settings.talents[${i}]`, 0, Number.MAX_SAFE_INTEGER)
    if (!game.talentById[id]) fail(`settings.talents[${i}]`, `天赋 ${id} 不存在`)
    return id
  })
  while (talents.length < 4) talents.push(null)
  return {
    target: oneOf(r.target, 'settings.target', ['power', 'weighted'] as const),
    weights,
    talents,
    budgetSec: oneOf(r.budgetSec, 'settings.budgetSec', BUDGET_CHOICES),
    threads: r.threads === 'auto' ? 'auto' : oneOf(r.threads, 'settings.threads', WORKER_CHOICES),
    seed: int(r.seed, 'settings.seed', 0, 0xffffffff),
    fillAll: bool(r.fillAll, 'settings.fillAll'),
    catalogFilters: validateFilters(r.catalogFilters),
  }
}

/**
 * 识图学习样本：非法或重复的条目直接丢弃（样本是增量积累的，丢几条不影响使用），
 * 但仍按装备数量封顶，避免备份无限膨胀。
 */
export function validateOcrSamples(v: unknown, _game: GameData): OcrSamplesData {
  if (!isObj(v)) fail('ocrSamples', '应为对象')
  const r = v as Record<string, unknown>
  const perEquip = new Map<number, number>()
  const samples: OcrSample[] = []
  for (const raw of arr(r.samples, 'ocrSamples.samples', MAX_SAMPLES)) {
    if (!isValidSample(raw)) continue
    const s = raw as OcrSample
    const used = perEquip.get(s.equipId) ?? 0
    if (used >= MAX_SAMPLES_PER_EQUIP) continue
    perEquip.set(s.equipId, used + 1)
    samples.push({
      equipId: s.equipId,
      points: s.points.map((p) => Math.round(p)),
      createdAt: typeof s.createdAt === 'string' ? s.createdAt.slice(0, 40) : '',
    })
  }
  return { samples }
}

export function validateSavedBoards(v: unknown, game: GameData): SavedBoard[] {
  return arr(v, 'savedBoards', 100).map((raw, i) => {
    const p = `savedBoards[${i}]`
    if (!isObj(raw)) fail(p, '应为对象')
    const r = raw as Record<string, unknown>
    if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 60) fail(`${p}.name`, '应为 1~60 字的名称')
    if (typeof r.score !== 'number' || !Number.isFinite(r.score)) fail(`${p}.score`, '应为数字')
    if (typeof r.savedAt !== 'number' || !Number.isFinite(r.savedAt)) fail(`${p}.savedAt`, '应为时间戳')
    if (typeof r.dataVersion !== 'string' || r.dataVersion.length > 40) fail(`${p}.dataVersion`, '应为字符串')
    return {
      name: (r.name as string).trim(),
      pieces: validatePieces(r.pieces, `${p}.pieces`, game),
      score: r.score as number,
      target: oneOf(r.target, `${p}.target`, ['power', 'weighted'] as const),
      savedAt: r.savedAt as number,
      dataVersion: r.dataVersion as string,
    }
  })
}
