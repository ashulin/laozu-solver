<script setup lang="ts">
import { computed } from 'vue'
import type { Shape, Tier } from '@/core/types'

const props = withDefaults(defineProps<{ shape: Shape; tier?: Tier; size?: number }>(), { tier: 1, size: 7 })

const cells = computed(() => {
  const filled = new Set(props.shape.cells.map(([r, c]) => `${r},${c}`))
  const out: boolean[] = []
  for (let r = 0; r < props.shape.h; r++) for (let c = 0; c < props.shape.w; c++) out.push(filled.has(`${r},${c}`))
  return out
})
</script>

<template>
  <span
    class="shape"
    :style="{ gridTemplateColumns: `repeat(${shape.w}, ${size}px)`, gridAutoRows: `${size}px` }"
    :title="`${shape.cellCount} 格`"
    aria-hidden="true"
  >
    <i v-for="(on, i) in cells" :key="i" :class="{ on }" :style="on ? { background: `var(--tier-${tier})` } : undefined" />
  </span>
</template>

<style scoped>
.shape { display: inline-grid; gap: 1px; vertical-align: middle; }
.shape i { border-radius: 1px; }
.shape i.on { box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.35); }
</style>
