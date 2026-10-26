<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useSolverStore } from '@/stores/solver'

const solver = useSolverStore()
const box = ref<HTMLElement | null>(null)
watch(() => solver.log.length, async () => {
  await nextTick()
  if (box.value) box.value.scrollTop = box.value.scrollHeight
})
</script>

<template>
  <section class="panel">
    <h2>计算日志</h2>
    <div ref="box" class="log" role="log">
      <div v-for="(line, i) in solver.log" :key="i">{{ line }}</div>
      <div v-if="!solver.log.length" class="muted">求解过程会记录在这里。</div>
    </div>
  </section>
</template>

<style scoped>
.log {
  max-height: 220px;
  overflow: auto;
  font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--bg);
  border-radius: 6px;
  padding: 8px;
  white-space: pre-wrap;
}
</style>
