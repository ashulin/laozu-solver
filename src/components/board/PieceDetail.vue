<script setup lang="ts">
import { computed } from 'vue'
import { GAME } from '@/core/data'
import { ELEMENT_NAME, FORM_NAME } from '@/core/types'
import type { BoardPiece } from '@/composables/board-view'
import { pct } from '@/core/awaken-text'
import ElderTag from '@/components/common/ElderTag.vue'

const props = defineProps<{ piece: BoardPiece; index: number; weighted: boolean }>()
const fmt = (n: number) => Math.round(n).toLocaleString('zh-CN')
const eq = computed(() => GAME.equipById[props.piece.equipId])
const attrName = (id: number | null) => (id === null ? '攻/防/血' : (GAME.attrById[id]?.name ?? String(id)).replace('百分比', ''))
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
  </div>
</template>

<style scoped>
.detail { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; }
.aw { color: #c9a0ff; }
.stats { font-variant-numeric: tabular-nums; }
.srcs { display: flex; flex-wrap: wrap; gap: 4px; }
.src { font-size: 12px; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 0 6px; }
</style>
