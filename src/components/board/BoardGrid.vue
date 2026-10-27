<script setup lang="ts">
import { computed } from 'vue'
import { COLS, ELEMENT_NAME, FORM_NAME, ROWS } from '@/core/types'
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
        ctl: cell.edge?.t && cell.edge?.l, ctr: cell.edge?.t && cell.edge?.r,
        cbl: cell.edge?.b && cell.edge?.l, cbr: cell.edge?.b && cell.edge?.r,
        editable,
      }"
      :style="cell.pi !== undefined ? { '--piece-color': `var(--tier-${pieces[cell.pi].tier})` } : undefined"
      :title="cell.pi !== undefined ? `#${cell.pi + 1} ${pieces[cell.pi].name}·${pieces[cell.pi].tier}阶` : cell.locked ? '未开放' : `${Math.floor(cell.idx / 7) + 1}行${(cell.idx % 7) + 1}列`"
      @click="onClick(cell.idx, cell.pi)"
    >
      <span v-if="cell.pi !== undefined && anchorOf[cell.pi] === cell.idx" class="tag">
        <span class="symbols"><span class="el" :style="{ background: `var(--el-${pieces[cell.pi].element})` }">{{ ELEMENT_NAME[pieces[cell.pi].element] }}</span><span v-if="pieces[cell.pi].cells.length > 1" class="form">{{ FORM_NAME[pieces[cell.pi].weaponForm] }}</span></span>
        <span class="piece-cells">{{ pieces[cell.pi].cells.length }}格<small v-if="pieces[cell.pi].awaken"> · 觉{{ pieces[cell.pi].awaken }}</small></span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.board {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0;
  width: 100%;
  max-width: 460px;
  padding: 6px;
  background: var(--outline);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: 0 8px 22px #0003, inset 0 1px 0 #ffffff0a;
  overflow: hidden;
  user-select: none;
}
.cell {
  position: relative;
  aspect-ratio: 1;
  min-width: 0;
  background: var(--bg-elev);
  border: 1px solid var(--outline);
  border-radius: 5px;
  box-shadow: inset 0 0 0 1px #ffffff0a;
  cursor: pointer;
}
.cell.filled { background: var(--piece-color); background: color-mix(in srgb, var(--piece-color) 88%, var(--bg-panel)); border: 0; border-radius: 0; box-shadow: none; }
.cell.et { border-top: 2px solid var(--outline); }
.cell.eb { border-bottom: 2px solid var(--outline); }
.cell.el { border-left: 2px solid var(--outline); }
.cell.er { border-right: 2px solid var(--outline); }
.cell.ctl { border-top-left-radius: 9px; }
.cell.ctr { border-top-right-radius: 9px; }
.cell.cbl { border-bottom-left-radius: 9px; }
.cell.cbr { border-bottom-right-radius: 9px; }
.cell.sel { filter: brightness(1.18); }
.cell.locked { background: repeating-linear-gradient(135deg, #252735, #252735 4px, #191b26 4px, #191b26 8px); }
.cell.editable:hover { box-shadow: inset 0 0 0 2px var(--gold); }
.tag {
  position: absolute;
  top: 2px;
  left: 2px;
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: rgba(15, 17, 25, 0.55);
  border-radius: 6px;
  padding: 2px 3px;
  line-height: 14px;
  pointer-events: none;
}
.tag .symbols { display: flex; gap: 3px; align-items: center; }
.tag .form { color: #fff; }
.tag .piece-cells { font-size: 10px; white-space: nowrap; }
.tag .el { display: inline-grid; place-items: center; width: 15px; height: 15px; border-radius: 50%; font-weight: 600; }
.tag small { color: #d7c2ff; font-size: 10px; }
</style>
