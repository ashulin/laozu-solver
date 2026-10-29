<script setup lang="ts">
/**
 * 优化器底部条（窄屏）：左侧是优化器内部的功能点导航（目录/已选/摆盘/目标/日志），
 * 右侧是求解/中止与进度。全局页面切换由顶部导航负责，这里不再重复。
 */
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useSolveProgress } from '@/composables/solve-progress'
import { useBagStore } from '@/stores/bag'
import { useSolverStore } from '@/stores/solver'

const bag = useBagStore()
const solver = useSolverStore()
const { progress } = useSolveProgress()
const route = useRoute()
// 只在优化器页显示；识图页有自己的导入条，长老页内容短，不需要
const hidden = computed(() => !route?.path?.startsWith('/solver'))

const SECTIONS = [
  { id: 'solver-catalog', label: '目录', icon: '▦' },
  { id: 'solver-selected', label: '已选', icon: '✓' },
  { id: 'solver-board', label: '摆盘', icon: '◈' },
  { id: 'solver-settings', label: '目标', icon: '◎' },
  { id: 'solver-log', label: '日志', icon: '≡' },
]
const active = ref('solver-selected')
function go(id: string) {
  active.value = id
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <nav v-if="!hidden" class="bottom-bar" aria-label="优化器功能导航与求解">
    <div class="tabs">
      <button
        v-for="s in SECTIONS" :key="s.id" type="button" class="tab" :class="{ on: active === s.id }"
        :aria-pressed="active === s.id" @click="go(s.id)"
      ><span class="ico" aria-hidden="true">{{ s.icon }}</span>{{ s.label }}</button>
    </div>
    <div class="solve">
      <div v-if="solver.running" class="progress" aria-label="求解进度"><i :style="{ width: `${progress}%` }" /></div>
      <button
        v-if="!solver.running" type="button" class="primary small" :disabled="!bag.selected.length" @click="solver.start()"
      >求解</button>
      <button v-else type="button" class="small" @click="solver.stop()">中止</button>
    </div>
  </nav>
</template>

<style scoped>
.bottom-bar {
  display: none;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  align-items: center;
  gap: 8px;
  padding: 6px 10px calc(6px + env(safe-area-inset-bottom));
  background: var(--bg-elev);
  border-top: 1px solid var(--line);
}
.tabs { display: flex; gap: 4px; min-width: 0; }
.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 3px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-dim);
  font-size: 11px;
  white-space: nowrap;
}
.ico { font-size: 14px; line-height: 14px; }
.tab.on { background: var(--gold-weak); color: var(--gold); }
.solve { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.progress { width: 84px; height: 5px; background: var(--bg); border-radius: 3px; overflow: hidden; }
.progress i { display: block; height: 100%; background: var(--gold); transition: width 0.25s linear; }
@media (max-width: 900px) {
  .bottom-bar { display: flex; }
}
</style>
