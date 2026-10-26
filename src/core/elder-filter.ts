/** 长老管理页筛选（纯函数）：维内「或」、维间「且」 */
import type { GameData } from './data'
import type { Elder, ElderConfig, ElderQuality, ElementId, WeaponForm } from './types'

export interface ElderFilter {
  keyword: string
  qualities: ElderQuality[]
  elements: ElementId[]
  forms: WeaponForm[]
  ownedOnly: boolean
}

export const emptyElderFilter = (): ElderFilter => ({ keyword: '', qualities: [], elements: [], forms: [], ownedOnly: false })

type Dim = 'qualities' | 'elements' | 'forms'

export function matchElder(game: GameData, elder: Elder, cfg: ElderConfig, f: ElderFilter, skip?: Dim): boolean {
  const eq = game.equipById[elder.redEquipId]
  if (skip !== 'qualities' && f.qualities.length && !f.qualities.includes(elder.quality)) return false
  if (skip !== 'elements' && f.elements.length && !f.elements.includes(eq.element)) return false
  if (skip !== 'forms' && f.forms.length && !f.forms.includes(eq.weaponForm)) return false
  if (f.ownedOnly && !cfg.owned) return false
  const kw = f.keyword.trim()
  return !kw || elder.name.includes(kw) || eq.name.includes(kw)
}

export interface ElderFacetCounts {
  qualities: Record<number, number>
  elements: Record<number, number>
  forms: Record<number, number>
}

/** 每个筛选项的命中数：计算某一维时忽略该维自身的已选条件 */
export function elderFacetCounts(game: GameData, list: { elder: Elder; config: ElderConfig }[], f: ElderFilter): ElderFacetCounts {
  const out: ElderFacetCounts = { qualities: {}, elements: {}, forms: {} }
  const inc = (m: Record<number, number>, k: number) => (m[k] = (m[k] ?? 0) + 1)
  for (const { elder, config } of list) {
    const eq = game.equipById[elder.redEquipId]
    if (matchElder(game, elder, config, f, 'qualities')) inc(out.qualities, elder.quality)
    if (matchElder(game, elder, config, f, 'elements')) inc(out.elements, eq.element)
    if (matchElder(game, elder, config, f, 'forms')) inc(out.forms, eq.weaponForm)
  }
  return out
}
