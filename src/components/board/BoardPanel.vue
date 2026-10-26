<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BoardMode } from '@/core/types'
import { useBoardView } from '@/composables/board-view'
import { toast } from '@/composables/toast'
import { useBagStore } from '@/stores/bag'
import { useBoardsStore } from '@/stores/boards'
import { useSettingsStore } from '@/stores/settings'
import { useSolverStore } from '@/stores/solver'
import BoardGrid from './BoardGrid.vue'
import PieceDetail from './PieceDetail.vue'

const bag = useBagStore()
const solver = useSolverStore()
const boards = useBoardsStore()
const settings = useSettingsStore()
const { model, compareBase, savedBoard, selectedBoard, hasLayout, hasCurrent, hasSaved } = useBoardView()
const selectedKey = ref<string | null>(null)
watch(() => solver.boardMode, () => (selectedKey.value = null))

const MODES: { mode: BoardMode; label: string }[] = [
  { mode: 'edit', label: '编辑背包' },
  { mode: 'layout', label: '实时摆盘' },
  { mode: 'current', label: '之前摆盘' },
  { mode: 'saved', label: '收藏摆盘' },
]
const enabled = (m: BoardMode) => m === 'edit' || (m === 'layout' && hasLayout.value) || (m === 'current' && hasCurrent.value) || (m === 'saved' && hasSaved.value)
const fmt = (n: number) => Math.round(n).toLocaleString('zh-CN')
const weighted = computed(() => settings.target === 'weighted')

const diff = computed(() => {
  if (model.value.score === null || compareBase.value === null) return null
  const d = model.value.score - compareBase.value
  return { d, pct: compareBase.value ? (d / compareBase.value) * 100 : 0 }
})
const selectedIndex = computed(() => model.value.pieces.findIndex((p) => p.key === selectedKey.value))

const replay = computed({
  get: () => solver.replayIndex ?? solver.milestones.length - 1,
  set: (v: number) => solver.setReplay(v >= solver.milestones.length - 1 ? null : v),
})

function saveBoard() {
  const pieces = solver.resultPieces
  if (!pieces || solver.result === null) return
  const def = `摆盘${boards.boards.length + 1} · ${fmt(solver.result.score)}`
  const name = window.prompt('收藏这份摆盘，起个名字（同名覆盖）：', def)
  if (name === null) return
  boards.save(name || def, pieces, solver.result.score, settings.target)
  toast('已收藏', 'ok')
}

function removeSaved() {
  if (savedBoard.value && window.confirm(`删除收藏「${savedBoard.value.name}」？`)) {
    boards.remove(savedBoard.value.name)
    selectedBoard.value = null
    if (!boards.boards.length) solver.setBoardMode('edit')
  }
}

function adopt() {
  if (!savedBoard.value || !window.confirm(`用「${savedBoard.value.name}」里的法宝替换当前已选列表？`)) return
  bag.adoptLayout(savedBoard.value.pieces)
  solver.setBoardMode('edit')
  toast('已替换已选列表', 'ok')
}
</script>

<template>
  <section class="panel board-panel">
    <h2>
      背包摆盘
      <span class="muted small">· {{ bag.usableCells }} 个可用格</span>
      <span class="modes">
        <button
          v-for="m in MODES"
          :key="m.mode"
          type="button"
          class="small"
          :class="{ on: solver.boardMode === m.mode }"
          :disabled="!enabled(m.mode)"
          @click="solver.setBoardMode(m.mode)"
        >{{ m.label }}</button>
      </span>
    </h2>

    <div class="score-line">
      <template v-if="solver.boardMode === 'edit'">
        <span class="muted small">点击格子切换「未开放格」（游戏里还没解锁的背包格）。</span>
        <button v-if="bag.lockedCells.length" type="button" class="ghost small" @click="bag.resetLocked()">全部开放</button>
      </template>
      <template v-else-if="model.score !== null">
        <span class="muted">{{ weighted ? '加权分' : '总战力' }}</span>
        <span class="big">{{ fmt(model.score) }}</span>
        <span v-if="model.live" class="live small">实时</span>
        <span v-if="diff" :class="diff.d >= 0 ? 'ok' : 'warn'" class="small">
          · 比实时摆盘{{ diff.d >= 0 ? '高' : '低' }} {{ fmt(Math.abs(diff.d)) }}（{{ diff.d >= 0 ? '+' : '−' }}{{ Math.abs(diff.pct).toFixed(1) }}%）
        </span>
        <span v-if="model.invalidCount" class="warn small">· {{ model.invalidCount }} 件因位置冲突未计入</span>
      </template>
      <span v-else-if="solver.boardMode === 'layout'" class="muted small">求解开始后这里会实时显示当前最优摆法。</span>
    </div>

    <BoardGrid
      :pieces="model.pieces"
      :locked="bag.lockedCells"
      :editable="solver.boardMode === 'edit'"
      :selected-key="selectedKey"
      @toggle-lock="bag.toggleLocked"
      @select="selectedKey = $event"
    />

    <div v-if="solver.boardMode === 'layout' && solver.milestones.length > 1" class="replay row">
      <span class="muted small">回放</span>
      <input v-model.number="replay" type="range" min="0" :max="solver.milestones.length - 1" step="1" aria-label="里程碑回放" />
      <span class="small muted">
        {{ solver.replayIndex === null ? '最新' : `${(solver.milestones[solver.replayIndex].elapsedMs / 1000).toFixed(1)}s` }}
      </span>
    </div>

    <div class="row actions">
      <button v-if="solver.boardMode === 'layout' && solver.result && !solver.running" type="button" class="small" @click="saveBoard">收藏这份摆盘</button>
      <template v-if="solver.boardMode === 'saved' && savedBoard">
        <select v-model="selectedBoard" aria-label="选择收藏">
          <option v-for="b in boards.boards" :key="b.name" :value="b.name">{{ b.name }}</option>
        </select>
        <button type="button" class="small" @click="adopt">采用这份摆盘</button>
        <button type="button" class="ghost small" @click="removeSaved">删除</button>
      </template>
    </div>

    <PieceDetail v-if="selectedIndex >= 0" :piece="model.pieces[selectedIndex]" :index="selectedIndex" :weighted="weighted" />
    <p v-else-if="model.pieces.length" class="muted small">点击棋盘上的法宝查看攻防血与加成来源。</p>
  </section>
</template>

<style scoped>
.board-panel { display: flex; flex-direction: column; gap: 10px; }
.modes { margin-left: auto; display: inline-flex; gap: 4px; flex-wrap: wrap; }
.modes button.on { border-color: var(--gold); color: var(--gold); background: var(--gold-weak); }
.score-line { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; min-height: 32px; }
.big { font-size: 24px; font-weight: 800; color: var(--gold); font-variant-numeric: tabular-nums; }
.live { color: var(--ok); border: 1px solid var(--ok); border-radius: 6px; padding: 0 6px; }
.replay input { flex: 1; max-width: 360px; accent-color: var(--gold); }
.actions:empty { display: none; }
</style>
