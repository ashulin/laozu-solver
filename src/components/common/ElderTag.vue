<script setup lang="ts">
import { computed } from 'vue'
import { GAME } from '@/core/data'
import { useEldersStore } from '@/stores/elders'

/** 「长老·孙悟空 ★3 觉醒2」徽标：所有出现红装的地方复用 */
const props = withDefaults(defineProps<{ equipId: number; compact?: boolean }>(), { compact: false })
const elders = useEldersStore()

const elder = computed(() => {
  const id = GAME.equipById[props.equipId]?.elderId
  return id !== undefined ? GAME.elderById[id] : undefined
})
const cfg = computed(() => (elder.value ? elders.config(elder.value.id) : undefined))
const hasAwaken = computed(() => !!(elder.value && GAME.awakenDb[elder.value.redEquipId]))
</script>

<template>
  <span v-if="elder && cfg" class="elder-tag" :class="[`q${elder.quality}`, { off: !cfg.owned }]" :title="cfg.owned ? '长老配置' : '未拥有该长老'">
    <span class="name">{{ compact ? elder.name : `长老·${elder.name}` }}</span>
    <template v-if="cfg.owned">
      <span class="star">★{{ cfg.star }}</span>
      <span v-if="hasAwaken" class="aw">觉醒{{ cfg.awakenCap }}</span>
    </template>
    <span v-else class="star">未拥有</span>
  </span>
</template>

<style scoped>
.elder-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  border: 1px solid currentColor;
}
.q2 { color: #64b5f6; }
.q3 { color: #ce93d8; }
.q4 { color: var(--gold); }
.off { opacity: 0.55; border-style: dashed; }
.star, .aw { color: var(--text-dim); }
</style>
