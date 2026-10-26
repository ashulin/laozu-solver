/** 法宝目录：按名称聚合各阶 + 多维筛选（纯函数） */
import { isPlayableEquip, type GameData } from './data'
import type { CatalogFilters, Elder, ElementId, Equip, Shape, Tier, WeaponForm } from './types'

export interface CatalogEntry {
  name: string
  element: ElementId
  weaponForm: WeaponForm
  shape: Shape
  cellCount: number
  tiers: Equip[] // 按阶升序
  elder?: Elder // 五阶红装绑定的长老
}

export function buildCatalog(game: GameData): CatalogEntry[] {
  const byName = new Map<string, CatalogEntry>()
  for (const eq of game.equips) {
    if (!isPlayableEquip(eq)) continue
    let entry = byName.get(eq.name)
    if (!entry) {
      const shape = game.shapeById[eq.shapeId]
      entry = { name: eq.name, element: eq.element, weaponForm: eq.weaponForm, shape, cellCount: shape.cellCount, tiers: [] }
      byName.set(eq.name, entry)
    }
    entry.tiers.push(eq)
    if (eq.elderId !== undefined) entry.elder = game.elderById[eq.elderId]
  }
  const list = [...byName.values()]
  for (const e of list) e.tiers.sort((a, b) => a.tier - b.tier)
  return list.sort((a, b) => a.element - b.element || a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

export function matchKeyword(entry: CatalogEntry, keyword: string): boolean {
  const kw = keyword.trim()
  if (!kw) return true
  return entry.name.includes(kw) || (entry.elder?.name.includes(kw) ?? false)
}

/** 维内「或」、维间「且」；品阶维度：任一阶命中即可 */
export function matchFilters(entry: CatalogEntry, f: CatalogFilters, skip?: keyof CatalogFilters): boolean {
  if (skip !== 'elements' && f.elements.length && !f.elements.includes(entry.element)) return false
  if (skip !== 'forms' && f.forms.length && !f.forms.includes(entry.weaponForm)) return false
  if (skip !== 'cellCounts' && f.cellCounts.length && !f.cellCounts.includes(entry.cellCount)) return false
  if (skip !== 'tiers' && f.tiers.length && !entry.tiers.some((t) => f.tiers.includes(t.tier))) return false
  if (skip !== 'keyword' && !matchKeyword(entry, f.keyword)) return false
  return true
}

export function filterCatalog(entries: CatalogEntry[], f: CatalogFilters): CatalogEntry[] {
  return entries.filter((e) => matchFilters(e, f))
}

export interface FacetCounts {
  elements: Record<number, number>
  forms: Record<number, number>
  cellCounts: Record<number, number>
  tiers: Record<number, number>
}

/** 每个筛选项的命中数：计算某一维时忽略该维自身的已选条件（chip 上显示「金(40)」） */
export function facetCounts(entries: CatalogEntry[], f: CatalogFilters): FacetCounts {
  const out: FacetCounts = { elements: {}, forms: {}, cellCounts: {}, tiers: {} }
  const inc = (m: Record<number, number>, k: number) => (m[k] = (m[k] ?? 0) + 1)
  for (const e of entries) {
    if (matchFilters(e, f, 'elements')) inc(out.elements, e.element)
    if (matchFilters(e, f, 'forms')) inc(out.forms, e.weaponForm)
    if (matchFilters(e, f, 'cellCounts')) inc(out.cellCounts, e.cellCount)
    if (matchFilters(e, f, 'tiers')) for (const t of new Set(e.tiers.map((x) => x.tier))) inc(out.tiers, t)
  }
  return out
}

/** 默认展示的阶：筛选了品阶时取命中的最高阶，否则取最高阶 */
export function defaultTierOf(entry: CatalogEntry, f: CatalogFilters): Tier {
  const hit = f.tiers.length ? entry.tiers.filter((t) => f.tiers.includes(t.tier)) : entry.tiers
  return (hit[hit.length - 1] ?? entry.tiers[entry.tiers.length - 1]).tier
}
