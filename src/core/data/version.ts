/** 游戏数据版本。重新提取数据后同步更新。 */
export const DATA_VERSION = {
  equips: '2026-09-23',
  awaken: '2026-10-11',
} as const

export const DATA_VERSION_TAG = `${DATA_VERSION.equips}/${DATA_VERSION.awaken}`
