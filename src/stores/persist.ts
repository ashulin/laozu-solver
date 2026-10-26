/** 自动持久化：store 有变化时写回 localStorage */
import { useBagStore } from './bag'
import { useBoardsStore } from './boards'
import { useEldersStore } from './elders'
import { useSettingsStore } from './settings'

export function enableAutoPersist(): () => void {
  const stores = [useEldersStore(), useBagStore(), useSettingsStore(), useBoardsStore()]
  const stops = stores.map((s) => s.$subscribe(() => s.persist(), { detached: true, flush: 'sync' }))
  return () => stops.forEach((stop) => stop())
}
