/** 应用级存储实例：浏览器用 localStorage，测试可替换为内存实现 */
import { GAME } from '@/core/data'
import { LocalStore, type StorageLike } from './storage'

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>()
  getItem(k: string) { return this.map.get(k) ?? null }
  setItem(k: string, v: string) { this.map.set(k, v) }
  removeItem(k: string) { this.map.delete(k) }
}

let backend: StorageLike | null = null
let store: LocalStore | null = null

export function setStorageBackend(s: StorageLike | null): void {
  backend = s
  store = null
}

export function memoryStorage(): StorageLike {
  return new MemoryStorage()
}

export function appStore(): LocalStore {
  if (!store) {
    const b = backend ?? (typeof localStorage !== 'undefined' ? localStorage : new MemoryStorage())
    store = new LocalStore(b, GAME)
  }
  return store
}
