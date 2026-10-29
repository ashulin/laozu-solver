/** 副本身份：够用即可，只在单个背包内区分同款不同件（老数据缺失时补齐） */
let seq = 0
export const newCopyId = (): string => `c${Date.now().toString(36)}${(seq++).toString(36)}`
