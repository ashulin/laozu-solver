import { reactive } from 'vue'

export interface ToastMsg {
  id: number
  text: string
  kind: 'info' | 'warn' | 'ok'
}

const state = reactive({ list: [] as ToastMsg[] })
let seq = 0

export function toast(text: string, kind: ToastMsg['kind'] = 'info', ms = 2600): void {
  const id = ++seq
  state.list.push({ id, text, kind })
  setTimeout(() => {
    const i = state.list.findIndex((t) => t.id === id)
    if (i >= 0) state.list.splice(i, 1)
  }, ms)
}

export function useToasts() {
  return state
}
