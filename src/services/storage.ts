/**
 * 本地存储：localStorage 封装（带 schema 版本信封）、备份导入导出、觉醒版数据迁移。
 * 导入只用 JSON.parse + 逐字段校验，不执行任何来自数据的代码。
 */
import type { GameData } from '@/core/data'
import { DATA_VERSION_TAG } from '@/core/data/version'
import type { Persisted, SavedBoard } from '@/core/types'
import {
  type BagData, type EldersData, type SettingsData, ValidationError, defaultSettings,
  validateBag, validateElders, validateSavedBoards, validateSettings,
} from './persist-schema'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const SCHEMA_VERSION = 1
export const KEYS = {
  elders: 'laozu-next:elders',
  bag: 'laozu-next:bag',
  settings: 'laozu-next:settings',
  savedBoards: 'laozu-next:saved-boards',
} as const
export type SectionName = keyof typeof KEYS

export interface Sections {
  elders: EldersData
  bag: BagData
  settings: SettingsData
  savedBoards: SavedBoard[]
}

const VALIDATORS: { [K in SectionName]: (v: unknown, game: GameData) => Sections[K] } = {
  elders: validateElders,
  bag: validateBag,
  settings: validateSettings,
  savedBoards: validateSavedBoards,
}

export const SECTION_LABEL: Record<SectionName, string> = {
  elders: '长老配置',
  bag: '已选法宝',
  settings: '求解设置',
  savedBoards: '收藏摆盘',
}

/* ---------------- 本地读写 ---------------- */
export class LocalStore {
  constructor(private readonly storage: StorageLike, private readonly game: GameData) {}

  /** 读取并校验；缺失、损坏或版本不符时返回 null（调用方用默认值） */
  load<K extends SectionName>(name: K): Sections[K] | null {
    let raw: string | null
    try {
      raw = this.storage.getItem(KEYS[name])
    } catch {
      return null
    }
    if (!raw) return null
    try {
      const env = JSON.parse(raw) as Persisted<unknown>
      if (!env || typeof env !== 'object' || env.v !== SCHEMA_VERSION) return null
      return VALIDATORS[name](env.data, this.game)
    } catch {
      return null
    }
  }

  save<K extends SectionName>(name: K, data: Sections[K]): void {
    const env: Persisted<Sections[K]> = { v: SCHEMA_VERSION, data }
    try {
      this.storage.setItem(KEYS[name], JSON.stringify(env))
    } catch {
      /* 配额满或隐私模式：静默失败，不影响使用 */
    }
  }

  remove(name: SectionName): void {
    this.storage.removeItem(KEYS[name])
  }
}

/* ---------------- 备份导入导出 ---------------- */
export const BACKUP_APP = 'laozu-solver-next'
export const MAX_BACKUP_BYTES = 2 * 1024 * 1024

export interface BackupFile {
  app: typeof BACKUP_APP
  v: number
  exportedAt: string
  dataVersion: string
  sections: Partial<Sections>
}

export function exportBackup(sections: Partial<Sections>, at = new Date()): string {
  const file: BackupFile = { app: BACKUP_APP, v: SCHEMA_VERSION, exportedAt: at.toISOString(), dataVersion: DATA_VERSION_TAG, sections }
  return JSON.stringify(file, null, 2)
}

export type ImportResult =
  | { ok: true; sections: Partial<Sections>; available: SectionName[] }
  | { ok: false; error: string }

/**
 * 解析并校验备份。`pick` 指定要导入的段（默认全部可用段）；任何被选中的段校验失败则整体拒绝。
 */
export function parseBackup(text: string, game: GameData, pick?: SectionName[]): ImportResult {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: '文件过大' }
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return { ok: false, error: '不是合法的 JSON' }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: '格式不正确' }
  const f = obj as Record<string, unknown>
  if (f.app !== BACKUP_APP) return { ok: false, error: '不是本工具导出的备份文件' }
  if (f.v !== SCHEMA_VERSION) return { ok: false, error: `备份版本 ${String(f.v)} 不受支持` }
  if (!f.sections || typeof f.sections !== 'object' || Array.isArray(f.sections)) return { ok: false, error: '缺少数据段' }
  const src = f.sections as Record<string, unknown>
  const available = (Object.keys(KEYS) as SectionName[]).filter((k) => src[k] !== undefined)
  const chosen = (pick ?? available).filter((k) => available.includes(k))
  if (!chosen.length) return { ok: false, error: '没有可导入的数据' }
  const sections: Partial<Sections> = {}
  try {
    for (const k of chosen) (sections as Record<string, unknown>)[k] = VALIDATORS[k](src[k], game)
  } catch (e) {
    return { ok: false, error: e instanceof ValidationError ? `校验失败 · ${e.message}` : '校验失败' }
  }
  return { ok: true, sections, available }
}

/* ---------------- 觉醒版迁移 ---------------- */
/** 在觉醒版页面的浏览器控制台运行，把数据复制到剪贴板 */
export const JUEXING_EXPORT_SNIPPET = "copy(localStorage.getItem('laozuSolverV1'))"

export interface MigrationResult {
  sections: Pick<Sections, 'elders' | 'bag'> & { settings: Partial<SettingsData> }
  notes: string[]
}

/**
 * 把觉醒版 localStorage「laozuSolverV1」转换为本工具的数据。
 * 觉醒版按法宝共享觉醒等级 → 迁移为对应长老的觉醒上限；已选红装每份副本取该上限。
 */
export function migrateFromJuexing(text: string, game: GameData): { ok: true; result: MigrationResult } | { ok: false; error: string } {
  let d: unknown
  try {
    d = JSON.parse(text)
  } catch {
    return { ok: false, error: '不是合法的 JSON（请粘贴控制台复制出的内容）' }
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, error: '格式不正确' }
  const r = d as Record<string, unknown>
  const notes: string[] = []
  const numMap = (v: unknown): Record<number, number> => {
    const out: Record<number, number> = {}
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (typeof x === 'number' && Number.isInteger(x)) out[+k] = x
      }
    }
    return out
  }
  const stars = numMap(r.elderStars)
  const awaken = numMap(r.awaken)

  const configs = new Map<number, { elderId: number; owned: boolean; star: number; awakenCap: number }>()
  for (const equipId of new Set([...Object.keys(stars), ...Object.keys(awaken)].map(Number))) {
    const elder = game.elderByRedEquip[equipId]
    if (!elder) continue
    const maxCap = game.awakenDb[equipId]?.maxLevel ?? 0
    configs.set(elder.id, {
      elderId: elder.id,
      owned: true,
      star: Math.max(0, Math.min(5, stars[equipId] ?? 0)),
      awakenCap: Math.max(0, Math.min(maxCap, awaken[equipId] ?? 0)),
    })
  }
  notes.push(`长老 ${configs.size} 位（星级/觉醒等级来自觉醒版）`)

  const selected: BagData['selected'] = []
  let skipped = 0
  if (Array.isArray(r.selected)) {
    for (const s of r.selected) {
      if (!s || typeof s !== 'object') continue
      const { name, tier, qty } = s as Record<string, unknown>
      const eq = game.equips.find((e) => e.name === name && e.tier === tier)
      if (!eq || typeof qty !== 'number' || qty < 1) {
        skipped++
        continue
      }
      const cap = eq.elderId !== undefined ? (configs.get(eq.elderId)?.awakenCap ?? 0) : 0
      selected.push({ equipId: eq.id, copies: Array.from({ length: Math.min(42, Math.floor(qty)) }, () => ({ awaken: cap })) })
    }
  }
  notes.push(`已选法宝 ${selected.length} 项${skipped ? `，${skipped} 项无法识别已跳过` : ''}`)

  const lockedCells = Array.isArray(r.locked)
    ? [...new Set(r.locked.filter((c): c is number => Number.isInteger(c) && c >= 0 && c < 42))]
    : []
  const settings: Partial<SettingsData> = {}
  const defaults = defaultSettings()
  if (r.target === 'power' || r.target === 'weighted') settings.target = r.target
  if (typeof r.fillAll === 'boolean') settings.fillAll = r.fillAll
  if (Array.isArray(r.talents)) {
    settings.talents = [0, 1, 2, 3].map((i) => {
      const id = Number((r.talents as unknown[])[i])
      return Number.isInteger(id) && game.talentById[id] ? id : null
    })
  } else settings.talents = defaults.talents

  return {
    ok: true,
    result: {
      sections: { elders: [...configs.values()], bag: { selected, lockedCells, previousLayout: null }, settings },
      notes,
    },
  }
}
