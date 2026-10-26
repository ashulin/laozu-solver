<script setup lang="ts">
import { computed } from 'vue'
import { COLS, ELEMENT_NAME, ROWS } from '@/core/types'
import type { BoardPiece } from '@/composables/board-view'

/** 6×7 棋盘：同件格子同色连成一块，与其它件/空格相邻的边画描边；锚点格显示编号 */
const props = withDefaults(defineProps<{
  pieces: BoardPiece[]
  locked: number[]
  editable?: boolean
  selectedKey?: string | null
}>(), { editable: false, selectedKey: null })
const emit = defineEmits<{ (e: 'toggle-lock', cell: number): void; (e: 'select', key: string | null): void }>()

const owner = computed(() => {
  const m = new Map<number, number>()
  props.pieces.forEach((p, i) => p.cells.forEach((c) => m.set(c, i)))
  return m
})
const lockedSet = computed(() => new Set(props.locked))
const anchorOf = computed(() => props.pieces.map((p) => Math.min(...p.cells)))

const cells = computed(() => {
  const out = []
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c
      const pi = owner.value.get(idx)
      const at = (rr: number, cc: number) => (rr < 0 || cc < 0 || rr >= ROWS || cc >= COLS ? -1 : (owner.value.get(rr * COLS + cc) ?? -1))
      const edge = pi === undefined ? null : {
        t: at(r - 1, c) !== pi, b: at(r + 1, c) !== pi, l: at(r, c - 1) !== pi, r: at(r, c + 1) !== pi,
      }
      out.push({ idx, pi, edge, locked: lockedSet.value.has(idx) })
    }
  }
  return out
})

function onClick(idx: number, pi: number | undefined) {
  if (props.editable) emit('toggle-lock', idx)
  else emit('select', pi === undefined ? null : props.pieces[pi].key === props.selectedKey ? null : props.pieces[pi].key)
}
</script>

<template>
  <div class="board" role="grid" :aria-label="editable ? '背包格子（点击切换未开放格）' : '背包摆盘'">
    <div
      v-for="cell in cells"
      :key="cell.idx"
      class="cell"
      role="gridcell"
      :class="{
        locked: cell.locked,
        filled: cell.pi !== undefined,
        sel: cell.pi !== undefined && pieces[cell.pi].key === selectedKey,
        et: cell.edge?.t, eb: cell.edge?.b, el: cell.edge?.l, er: cell.edge?.r,
        editable,
      }"
      :style="cell.pi !== undefined ? { background: `var(--tier-${pieces[cell.pi].tier})` } : undefined"
      :title="cell.pi !== undefined ? `#${cell.pi + 1} ${pieces[cell.pi].name}·${pieces[cell.pi].tier}阶` : cell.locked ? '未开放' : `${Math.floor(cell.idx / 7) + 1}行${(cell.idx % 7) + 1}列`"
      @click="onClick(cell.idx, cell.pi)"
    >
      <span v-if="cell.pi !== undefined && anchorOf[cell.pi] === cell.idx" class="tag">
        <span class="el" :style="{ background: `var(--el-${pieces[cell.pi].element})` }">{{ ELEMENT_NAME[pieces[cell.pi].element] }}</span>{{ cell.pi + 1 }}<template v-if="pieces[cell.pi].awaken"><small>觉{{ pieces[cell.pi].awaken }}</small></template>
      </span>
    </div>
  </div>
</template>

<style scoped>
.board {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0;
  width: 100%;
  max-width: 460px;
  aspect-ratio: 7 / 6;
  background: var(--bg);
  border: 2px solid var(--outline);
  border-radius: 8px;
  overflow: hidden;
  user-select: none;
}
.cell {
  position: relative;
  box-shadow: inset 0 0 0 1px var(--line);
  cursor: pointer;
}
.cell.filled { box-shadow: none; }
.cell.et { border-top: 2px solid var(--outline); }
.cell.eb { border-bottom: 2px solid var(--outline); }
.cell.el { border-left: 2px solid var(--outline); }
.cell.er { border-right: 2px solid var(--outline); }
.cell.sel { filter: brightness(1.25); }
.cell.locked { background: repeating-linear-gradient(45deg, #232836, #232836 6px, #1b1f29 6px, #1b1f29 12px); }
.cell.editable:hover { box-shadow: inset 0 0 0 2px var(--gold); }
.tag {
  position: absolute;
  top: 2px;
  left: 2px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: rgba(0, 0, 0, 0.45);
  border-radius: 5px;
  padding: 0 3px;
  line-height: 15px;
}
.tag .el { border-radius: 3px; padding: 0 2px; font-weight: 600; }
.tag small { color: #d7c2ff; font-size: 10px; }
</style>
