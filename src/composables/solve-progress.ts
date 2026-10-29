/** 求解进度：按预算时间推进的估算，供求解条与底部操作条共用 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useSolverStore } from '@/stores/solver'
import { useSettingsStore } from '@/stores/settings'

export function useSolveProgress() {
  const solver = useSolverStore()
  const settings = useSettingsStore()
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | null = null
  watch(() => solver.running, (r) => {
    if (timer) clearInterval(timer)
    timer = r ? setInterval(() => (now.value = Date.now()), 250) : null
  }, { immediate: true })
  onBeforeUnmount(() => timer && clearInterval(timer))
  const progress = computed(() => (solver.running
    ? Math.min(99, ((now.value - solver.startedAt) / 1000 / settings.budgetSec) * 100)
    : solver.result ? 100 : 0))
  return { progress }
}
