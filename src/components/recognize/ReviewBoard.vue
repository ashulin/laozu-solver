<script setup lang="ts">
import { computed } from 'vue'
import BoardGrid from '@/components/board/BoardGrid.vue'
import { GAME } from '@/core/data'
import { matchesReviewFilter, REVIEW_STATUS_NAME, reviewFootprints, reviewTargets, type ReviewFilter } from '@/core/ocr/review-board'
import type { RecognitionCell } from '@/core/ocr/recognize'
import type { BoardPiece } from '@/composables/board-view'

const props = withDefaults(defineProps<{
  cells: RecognitionCell[]
  activeIndex: number
  filter?: ReviewFilter
  skipPending?: boolean
  disabled?: boolean
}>(), { filter: 'all', skipPending: false, disabled: false })
const emit = defineEmits<{ (e: 'cell-click', index: number): void }>()
const footprints = computed(() => reviewFootprints(props.cells, props.skipPending))
const ordered = computed(() => [...footprints.value].sort((a, b) =>
  Number(a.index === props.activeIndex) - Number(b.index === props.activeIndex)
  || Number(a.status !== 'excluded') - Number(b.status !== 'excluded')))
const pieces = computed<BoardPiece[]>(() => ordered.value.flatMap((p) => {
  const eq = p.source.equipId ? GAME.equipById[p.source.equipId] : null
  return eq ? [{ key: String(p.index), equipId: eq.id, name: eq.name, tier: eq.tier, element: eq.element,
    weaponForm: eq.weaponForm, awaken: p.source.awaken ?? 0, cells: p.cells }] : []
}))
const visualCells = computed(() => Array.from({ length: 42 }, (_, index) => {
  const targets = reviewTargets(footprints.value, index)
  const covering = ordered.value.filter((p) => p.cells.includes(index))
  const shown = covering.filter((p) => p.source.kind === 'piece').at(-1) ?? covering.at(-1)
  const anchor = footprints.value.find((p) => p.index === index)
  const status = anchor?.status ?? shown?.status ?? 'unknown'
  const occupied = shown?.cells ?? [index]
  const edge = {
    top: index < 7 || !occupied.includes(index - 7), bottom: index >= 35 || !occupied.includes(index + 7),
    left: index % 7 === 0 || !occupied.includes(index - 1), right: index % 7 === 6 || !occupied.includes(index + 1),
  }
  const active = footprints.value.find((p) => p.index === props.activeIndex)
  const selected = active?.cells.includes(index) ?? false
  const selectedEdge = {
    top: selected && (index < 7 || !active?.cells.includes(index - 7)), bottom: selected && (index >= 35 || !active?.cells.includes(index + 7)),
    left: selected && (index % 7 === 0 || !active?.cells.includes(index - 1)), right: selected && (index % 7 === 6 || !active?.cells.includes(index + 1)),
  }
  const multiple = targets.filter((i) => footprints.value.find((p) => p.index === i)?.status !== 'excluded').length > 1
  const names = targets.map((i) => {
    const cell = props.cells[i]
    const eq = cell?.equipId ? GAME.equipById[cell.equipId] : null
    return `${Math.floor(i / 7) + 1},${i % 7 + 1} ${eq?.name ?? '格子'} · ${REVIEW_STATUS_NAME[footprints.value.find((p) => p.index === i)?.status ?? 'unknown']}`
  })
  const muted = !selected && !covering.some((p) => matchesReviewFilter(p.source, props.filter, props.skipPending))
  const badge = multiple || status === 'conflict' ? '!' : status === 'unknown' || status === 'pending' ? '?' : status === 'checked' ? '核' : status === 'excluded' ? '删' : ''
  return { index, status: shown?.status ?? status, anchor, edge, selected, selectedEdge, muted, multiple,
    badge, label: `第${Math.floor(index / 7) + 1}行第${index % 7 + 1}列：${names.join(' / ') || '空格'}${multiple ? '，点击选择涉及法宝' : ''}` }
}))
function keydown(event: KeyboardEvent, index: number) {
  const delta = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 })[event.key]
  if (delta === undefined) return
  event.preventDefault()
  const next = Math.max(0, Math.min(41, index + delta))
  const button = (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLButtonElement>(`[data-cell="${next}"]`)
  button?.focus()
}
</script>

<template>
  <div class="review-board" :aria-busy="disabled">
    <div class="visual" aria-hidden="true"><BoardGrid :pieces="pieces" :locked="cells.flatMap((c, i) => c.kind === 'locked' ? [i] : [])" :selected-key="String(activeIndex)" /></div>
    <div class="review-hit-grid" role="group" aria-label="识别背包，点击格子核对">
      <button v-for="cell in visualCells" :key="cell.index" type="button" class="review-cell" :data-cell="cell.index"
        :class="[cell.status, { muted: cell.muted, overlap: cell.multiple, selected: cell.selected,
          et: cell.edge.top, eb: cell.edge.bottom, el: cell.edge.left, er: cell.edge.right,
          st: cell.selectedEdge.top, sb: cell.selectedEdge.bottom, sl: cell.selectedEdge.left, sr: cell.selectedEdge.right }]"
        :disabled="disabled" :aria-label="cell.label" :title="cell.label" :aria-pressed="cell.selected" :aria-current="cell.index === activeIndex ? 'true' : undefined"
        @click="emit('cell-click', cell.index)" @keydown="keydown($event, cell.index)">
        <span v-if="cell.badge && (cell.anchor || cell.multiple)" class="state-badge" :class="{ 'at-center': !cell.anchor?.source.equipId }">{{ cell.badge }}</span>
        <span v-if="cell.anchor?.source.kind === 'locked'" class="lock-label">锁</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.review-board { position: relative; width: 100%; }
.visual { pointer-events: none; }.visual :deep(.board) { max-width: none; }.visual :deep(.tag) { max-width: calc(100% - 3px); }
.review-hit-grid { position: absolute; inset: 0; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); grid-template-rows: repeat(6, minmax(0, 1fr)); padding: 7px; }
.review-cell { position: relative; padding: 0; min-width: 0; border: 2px solid transparent; border-radius: 0; background: transparent; isolation: isolate; }
.review-cell:hover:not(:disabled) { border-color: transparent; background-color: #ffffff12; }.review-cell:focus-visible { outline: 2px solid white; outline-offset: -5px; z-index: 2; }
.review-cell::before { content: ''; position: absolute; inset: -1px; border: 1px solid transparent; pointer-events: none; z-index: -1; }
.pending, .unknown { --status-color: var(--warn); }.conflict { --status-color: #ff8585; }.excluded { --status-color: #aab0bf; background: #161b26b8; }
.pending.et::before, .unknown.et::before, .conflict.et::before, .excluded.et::before { border-top-color: var(--status-color); border-top-style: dashed; }
.pending.eb::before, .unknown.eb::before, .conflict.eb::before, .excluded.eb::before { border-bottom-color: var(--status-color); border-bottom-style: dashed; }
.pending.el::before, .unknown.el::before, .conflict.el::before, .excluded.el::before { border-left-color: var(--status-color); border-left-style: dashed; }
.pending.er::before, .unknown.er::before, .conflict.er::before, .excluded.er::before { border-right-color: var(--status-color); border-right-style: dashed; }
.overlap { background-image: repeating-linear-gradient(135deg, transparent, transparent 5px, #ff858568 5px, #ff858568 8px); }
.muted::after { content: ''; position: absolute; inset: -2px; background: #11182791; pointer-events: none; z-index: 2; }
.review-cell.st { border-top-color: white; }.review-cell.sb { border-bottom-color: white; }.review-cell.sl { border-left-color: white; }.review-cell.sr { border-right-color: white; }
.et.el, .st.sl { border-top-left-radius: 8px; }.et.er, .st.sr { border-top-right-radius: 8px; }.eb.el, .sb.sl { border-bottom-left-radius: 8px; }.eb.er, .sb.sr { border-bottom-right-radius: 8px; }
.state-badge { position: absolute; right: 1px; bottom: 1px; min-width: 15px; border-radius: 4px; padding: 0 2px; background: #111e; color: var(--status-color, var(--ok)); font-size: 11px; font-weight: 700; line-height: 15px; }
.at-center { left: 50%; top: 50%; right: auto; bottom: auto; transform: translate(-50%, -50%); font-size: 17px; }
.lock-label { color: var(--text-dim); font-size: 11px; }
</style>
