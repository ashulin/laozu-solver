/** 数值单位：百分比类数值均为 /10000 */
export const DE = 10000

export const A_ATK = 2001
export const A_DEF = 2002
export const A_HP = 2003
export const A_ATKP = 2004
export const A_DEFP = 2005
export const A_HPP = 2006

/** 强制填满时每占一格加的分（与原版、觉醒版同值） */
export const FILL_BONUS = 1e7

/** 天赋百分比属性 → 作用的基础属性 */
export const PCT_TO_BASE: Record<number, number> = { [A_ATKP]: A_ATK, [A_DEFP]: A_DEF, [A_HPP]: A_HP }
