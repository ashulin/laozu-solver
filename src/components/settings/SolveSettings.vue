<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { GAME } from '@/core/data'
import { WORKER_CHOICES } from '@/core/solver/temperature'
import { BUDGET_CHOICES } from '@/services/persist-schema'
import { useBagStore } from '@/stores/bag'
import { useSettingsStore } from '@/stores/settings'
import { useSolverStore } from '@/stores/solver'
import ElderTag from '@/components/common/ElderTag.vue'
import ElderCard from '@/components/elders/ElderCard.vue'
import { useEldersStore } from '@/stores/elders'
import TalentPicker from './TalentPicker.vue'

const settings = useSettingsStore()
const solver = useSolverStore()
const bag = useBagStore()
const elders = useEldersStore()

const involvedElders = computed(() => elders.views.filter((v) => bag.selected.some((it) => it.equipId === v.redEquip.id)))
const awakenInUse = computed(() => bag.selected.some((it) => it.copies.some((c) => c.awaken > 0)))

// 进度条按时间推进
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
watch(() => solver.running, (r) => {
  if (timer) clearInterval(timer)
  timer = r ? setInterval(() => (now.value = Date.now()), 250) : null
}, { immediate: true })
onBeforeUnmount(() => timer && clearInterval(timer))
const progress = computed(() => (solver.running ? Math.min(99, ((now.value - solver.startedAt) / 1000 / solver.budgetSec) * 100) : solver.result ? 100 : 0))
</script>

<template>
  <section class="panel settings">
    <h2>目标与求解</h2>

    <div class="row">
      <label class="row small"><input v-model="settings.target" type="radio" value="power" />战力最大化</label>
      <label class="row small"><input v-model="settings.target" type="radio" value="weighted" />自定义权重</label>
    </div>
    <div v-if="settings.target === 'weighted'" class="weights">
      <p class="muted small">各属性权重（默认等于游戏战力系数）：</p>
      <label v-for="a in GAME.attrs" :key="a.id" class="wrow small">
        <span>{{ a.name }}</span>
        <input type="number" min="0" step="any" :value="settings.weights[a.id] ?? a.nPower" @change="settings.setWeight(a.id, +($event.target as HTMLInputElement).value)" />
      </label>
      <button type="button" class="ghost small" @click="settings.resetWeights()">恢复默认</button>
    </div>

    <div class="block">
      <div class="muted small">弟子天赋（按武器形态放大法宝基础三围）</div>
      <div class="talents">
        <TalentPicker
          v-for="i in 4"
          :key="i"
          :model-value="settings.talents[i - 1] ?? null"
          :label="`天赋${i}`"
          :disabled-ids="settings.talents"
          @update:model-value="settings.setTalent(i - 1, $event)"
        />
      </div>
    </div>

    <div v-if="involvedElders.length" class="block involved-elders">
      <div class="muted small">涉及长老 · 点击直接修改</div>
      <div class="elder-editors">
        <details v-for="view in involvedElders" :key="view.elder.id" class="elder-editor">
          <summary :aria-label="`修改长老${view.elder.name}`"><ElderTag :equip-id="view.redEquip.id" /><span class="edit-label small">修改</span></summary>
          <div class="elder-editor-body">
            <p class="muted small">修改立即保存至当前账号，与「长老管理」同步。</p>
            <ElderCard :view="view" />
          </div>
        </details>
      </div>
      <p v-if="solver.running" class="muted small elder-note">当前求解使用启动时的配置；修改后请重新求解。</p>
    </div>

    <div class="row params">
      <label class="row small"><input v-model="settings.fillAll" type="checkbox" />强制填满</label>
      <label class="row small">时间
        <select v-model.number="settings.budgetSec"><option v-for="b in BUDGET_CHOICES" :key="b" :value="b">{{ b }} 秒</option></select>
      </label>
      <label class="row small">线程
        <select v-model="settings.threads">
          <option value="auto">自动（{{ settings.threads === 'auto' ? settings.threadCount : '' }}）</option>
          <option v-for="n in WORKER_CHOICES" :key="n" :value="n">{{ n }}</option>
        </select>
      </label>
      <label class="row small">种子
        <input v-model.number="settings.seed" type="number" min="0" class="seed" />
      </label>
    </div>
    <p v-if="awakenInUse && settings.budgetSec < 60" class="muted small">
      开了觉醒的红装会让搜索空间变复杂，建议预算 60 秒。
      <button type="button" class="ghost small" @click="settings.budgetSec = 60">设为 60 秒</button>
    </p>

    <div class="solve-bar">
      <button v-if="!solver.running" type="button" class="primary" :disabled="!bag.selected.length" @click="solver.start()">开始求解</button>
      <button v-else type="button" @click="solver.stop()">中止（用当前最优）</button>
      <div class="progress" aria-label="求解进度"><i :style="{ width: `${progress}%` }" /></div>
    </div>
    <p v-if="solver.error" class="danger small">{{ solver.error }}</p>
  </section>
</template>

<style scoped>
.settings { display: flex; flex-direction: column; gap: 10px; }
.weights { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 4px 10px; }
.weights p { grid-column: 1 / -1; margin: 0; }
.wrow { display: flex; align-items: center; gap: 6px; justify-content: space-between; }
.wrow input { width: 72px; }
.block { display: flex; flex-direction: column; gap: 4px; }
.talents { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
.elder-editors { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; }
.elder-editor { min-width: 0; max-width: 100%; border: 1px solid var(--line); border-radius: 10px; background: var(--bg-elev); }
.elder-editor[open] { flex-basis: 100%; }
.elder-editor summary { display: flex; align-items: center; gap: 8px; padding: 7px 9px; cursor: pointer; list-style: none; border-radius: 9px; }
.elder-editor summary::-webkit-details-marker { display: none; }
.elder-editor summary:hover, .elder-editor summary:focus-visible { background: var(--gold-weak); outline: 1px solid var(--gold); }
.edit-label { color: var(--gold); margin-left: auto; white-space: nowrap; }
.edit-label::after { content: ' ▾'; }
.elder-editor[open] .edit-label::after { content: ' ▴'; }
.elder-editor-body { padding: 0 8px 8px; }
.elder-editor-body p { margin: 2px 2px 8px; }
.elder-note { margin: 4px 0 0; }
.params { gap: 12px; }
.seed { width: 80px; }
.solve-bar { display: flex; align-items: center; gap: 10px; }
.progress { flex: 1; height: 6px; background: var(--bg); border-radius: 3px; overflow: hidden; }
.progress i { display: block; height: 100%; background: var(--gold); transition: width 0.25s linear; }
@media (max-width: 900px) {
  .solve-bar {
    position: sticky;
    bottom: 0;
    background: var(--bg-panel);
    padding: 8px 0;
    border-top: 1px solid var(--line);
    z-index: 5;
  }
}
</style>
