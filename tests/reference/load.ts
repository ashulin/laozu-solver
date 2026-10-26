/**
 * 在 vm 沙箱中加载觉醒版原始求解代码，用于对拍。
 * 只加载本仓库 tests/reference/ 下的固定副本，不访问网络与外部路径。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import type { GameData } from '@/core/data'

const DIR = dirname(fileURLToPath(import.meta.url))

export interface ReferenceImpl {
  evaluate(pl: unknown[], ctx: unknown, detail: boolean): { powerTotal: number; weightedTotal: number; pieces: unknown[] }
  effBase(eq: unknown, starsMap: Record<number, number>, talentMap: unknown, attr: number, awakenMap: Record<number, number>): number
  buildTalentMap(ids: unknown[]): unknown
}

export function loadReference(game: GameData): ReferenceImpl {
  const context = vm.createContext({
    performance: { now: () => 0 },
    postMessage: () => {},
    DE: 10000,
    TALENT_BY_ID: game.talentById,
    __data: { skillById: game.skillById, awakenDb: game.awakenDb, attrs: game.attrs },
  })
  vm.runInContext(readFileSync(resolve(DIR, 'juexing-solver-worker.js'), 'utf8'), context)
  vm.runInContext(readFileSync(resolve(DIR, 'juexing-effbase.js'), 'utf8'), context)
  // 觉醒版 Worker 的数据是 let 全局变量，由主线程传入；同一 context 内的脚本共享全局词法环境
  vm.runInContext('SKILL_BY_ID=__data.skillById;AWAKEN_DB=__data.awakenDb;ATTRS=__data.attrs;', context)
  return {
    evaluate: (pl, ctx, detail) => context.evaluate(pl, ctx, detail),
    effBase: (eq, s, t, a, aw) => context.effBase(eq, s, t, a, aw),
    buildTalentMap: (ids) => context.buildTalentMap(ids),
  }
}
