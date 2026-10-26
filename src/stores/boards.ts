/** 收藏摆盘 */
import { defineStore } from 'pinia'
import { DATA_VERSION_TAG } from '@/core/data/version'
import type { SavedBoard, SavedPiece, Target } from '@/core/types'
import { appStore } from '@/services/app-storage'

export const MAX_SAVED_BOARDS = 100

export const useBoardsStore = defineStore('boards', {
  state: () => ({ boards: appStore().load('savedBoards') ?? ([] as SavedBoard[]) }),
  actions: {
    /** 同名覆盖 */
    save(name: string, pieces: SavedPiece[], score: number, target: Target) {
      const n = name.trim().slice(0, 60) || `摆盘${this.boards.length + 1}`
      const board: SavedBoard = { name: n, pieces: pieces.map((p) => ({ ...p })), score, target, savedAt: Date.now(), dataVersion: DATA_VERSION_TAG }
      const i = this.boards.findIndex((b) => b.name === n)
      if (i >= 0) this.boards[i] = board
      else this.boards.unshift(board)
      if (this.boards.length > MAX_SAVED_BOARDS) this.boards.length = MAX_SAVED_BOARDS
      return board
    },
    remove(name: string) {
      this.boards = this.boards.filter((b) => b.name !== name)
    },
    replaceAll(boards: SavedBoard[]) {
      this.boards = boards.map((b) => ({ ...b, pieces: b.pieces.map((p) => ({ ...p })) }))
    },
    persist() {
      appStore().save('savedBoards', this.boards)
    },
  },
})
