/** 弟子天赋按武器形态分组（供两级选择器使用） */
import type { GameData } from './data'
import { FORMS } from './types'
import type { Talent, WeaponForm } from './types'

export interface TalentGroup {
  form: WeaponForm
  talents: Talent[] // 加成高的在前；同档按名称
}

export function talentGroups(game: GameData): TalentGroup[] {
  return FORMS.map((form) => ({
    form,
    talents: game.talents
      .filter((t) => t.form === form)
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'zh-Hans-CN')),
  })).filter((g) => g.talents.length > 0)
}

/** 去掉描述末尾的句号，便于在一行内展示 */
export const talentDesc = (t: Talent) => t.desc.replace(/。$/, '')
