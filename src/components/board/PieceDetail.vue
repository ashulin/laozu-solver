<script setup lang="ts">
import { computed } from 'vue'
import { GAME } from '@/core/data'
import { ELEMENT_NAME, FORM_NAME } from '@/core/types'
import type { BoardPiece } from '@/composables/board-view'
import { pct } from '@/core/awaken-text'
import ElderTag from '@/components/common/ElderTag.vue'
import { useBagStore } from '@/stores/bag'
import { useEldersStore } from '@/stores/elders'
import { toast } from '@/composables/toast'

const props = defineProps<{ piece: BoardPiece; index: number; weighted: boolean; editable?: boolean }>()
const bag = useBagStore()
const elders = useEldersStore()
const fmt = (n: number) => Math.round(n).toLocaleString('zh-CN')
const eq = computed(() => GAME.equipById[props.piece.equipId])
const attrName = (id: number | null) => (id === null ? '攻/防/血' : (GAME.attrById[id]?.name ?? String(id)).replace('百分比', ''))

/** 片段锚点：占格里最小行、最小列（形状已归一化，等于「之前摆盘」记录的 r,c） */
const anchor = computed(() => ({
  r: Math.min(...props.piece.cells.map((i) => Math.floor(i / 7))),
  c: Math.min(...props.piece.cells.map((i) => i % 7)),
}))
const isRed = computed(() => eq.value.elderId !== undefined)
const hasAwaken = computed(() => isRed.value && !!GAME.awakenDb[eq.value.id])
const awakenCap = computed(() => isRed.value ? elders.config(eq.value.elderId!).awakenCap : 0)
const nextTier = computed(() => isRed.value ? null : GAME.equips.find((e) => e.name === eq.value.name && e.shapeId === eq.value.shapeId && e.tier === eq.value.tier + 1) ?? null)

function upgrade() {
  const r = bag.upgradePlaced(anchor.value.r, anchor.value.c)
  if (!r.ok) toast(r.reason, 'warn', 3500)
}
function remove() {
  bag.removePlaced(anchor.value.r, anchor.value.c)
}
function setAwaken(value: number) {
  bag.setPlacedAwaken(anchor.value.r, anchor.value.c, value)
}
</script>

<template>
  <div v-if="piece.detail" class="detail">
    <div class="row">
      <b>#{{ index + 1 }} {{ piece.name }}</b>
      <span class="muted small">{{ piece.tier }}阶 · {{ ELEMENT_NAME[eq.element] }}{{ FORM_NAME[eq.weaponForm] }}</span>
      <span v-if="piece.awaken" class="small aw">觉醒{{ piece.awaken }}</span>
      <ElderTag :equip-id="piece.equipId" compact />
    </div>
    <div class="small stats">
      攻 {{ fmt(piece.detail.atk) }} · 防 {{ fmt(piece.detail.def) }} · 血 {{ fmt(piece.detail.hp) }} ·
      <b>{{ weighted ? '加权分' : '战力' }} {{ fmt(weighted ? piece.detail.weighted : piece.detail.power) }}</b>
    </div>
    <div v-if="piece.detail.srcs.length" class="srcs">
      <span v-for="(s, i) in piece.detail.srcs" :key="i" class="src" :title="s.names?.join('、')">
        {{ attrName(s.attr) }} +{{ pct(s.value) }}
        <template v-if="s.t === 'self' || s.t === 'awakenSelf'">×{{ s.n }}</template>
        <template v-else>← {{ s.from }}</template>
        <span v-if="s.t.startsWith('awaken')" class="muted">（{{ s.skill }}）</span>
      </span>
    </div>
    <div v-else class="muted small">没有相邻加成</div>
    <div v-if="editable" class="row ops">
      <label v-if="hasAwaken" class="aw-edit small">觉醒
        <select :value="piece.awaken" :aria-label="`${piece.name}觉醒等级`" @change="setAwaken(+($event.target as HTMLSelectElement).value)">
          <option v-for="lv in awakenCap + 1" :key="lv" :value="lv - 1">{{ lv === 1 ? '未觉醒' : `觉醒${lv - 1}` }}</option>
        </select>
      </label>
      <button v-if="nextTier" type="button" class="small" :title="`升为 ${nextTier.tier} 阶`" @click="upgrade">升阶</button>
      <button type="button" class="small danger" @click="remove">删除此法宝</button>
    </div>
  </div>
</template>

<style scoped>
.detail { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; }
.aw { color: #c9a0ff; }
.stats { font-variant-numeric: tabular-nums; }
.srcs { display: flex; flex-wrap: wrap; gap: 4px; }
.src { font-size: 12px; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 0 6px; }
.ops { margin-top: 4px; gap: 8px; align-items: center; flex-wrap: wrap; }
.aw-edit { display: inline-flex; align-items: center; gap: 4px; }
.aw-edit select { padding: 1px 4px; }
</style>
