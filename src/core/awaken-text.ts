/** 觉醒效果 → 中文描述 */
import type { GameData } from './data'
import { ELEMENT_NAME, FORM_NAME } from './types'
import type { AwakenEffect, AwakenEntry } from './types'

export const pct = (v: number) => `${+(v / 100).toFixed(2)}%`

function attrName(game: GameData, id: number): string {
  return (game.attrById[id]?.name ?? String(id)).replace('百分比', '')
}

export function describeAwakenEffect(ef: AwakenEffect, game: GameData): string {
  switch (ef.type) {
    case 'self_per_adjacent':
      return `每相邻 1 件${ELEMENT_NAME[ef.element]}系法宝，自身${attrName(game, ef.attr)} +${pct(ef.perUnit)}`
    case 'self_mult':
      return `自身攻/防/血 +${pct(ef.pct)}`
    case 'adjacent_buff':
      return `相邻${ELEMENT_NAME[ef.element]}系法宝攻/防/血 +${pct(ef.pct)}`
    case 'global_form':
      return `背包内${FORM_NAME[ef.form]}形态法宝攻/防/血 +${pct(ef.pct)}（不含自身）`
    case 'global_element':
      return `背包内${ELEMENT_NAME[ef.element]}系法宝攻/防/血 +${pct(ef.pct)}（不含自身）`
  }
}

/** 每一级的效果文本（只列该级新增的效果；个别法宝某级为空，如大鹏的觉2） */
export function describeAwakenLevels(entry: AwakenEntry, game: GameData): { level: number; lines: string[] }[] {
  const out: { level: number; lines: string[] }[] = []
  for (let lv = 1; lv <= entry.maxLevel; lv++) {
    const lines = (entry.levels[lv] ?? []).map((ef) => describeAwakenEffect(ef, game))
    out.push({ level: lv, lines: lines.length ? lines : ['无新增效果'] })
  }
  return out
}
