<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { GAME, isPlayableEquip } from '@/core/data'
import { CELL_COUNTS, ELEMENTS, ELEMENT_NAME, FORMS, FORM_NAME, TIERS, TIER_NAME } from '@/core/types'

const props = defineProps<{ modelValue: number | null; suggestedId?: number }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: number): void }>()
const filters = reactive({ element: 0, cells: 0, tier: 0, form: -1 })
const keyword = ref('')
const equips = GAME.equips.filter(isPlayableEquip)
const label = (id: number) => {
  const e = GAME.equipById[id]
  const elder = e.elderId !== undefined ? GAME.elderById[e.elderId]?.name : null
  return `${e.name} · ${GAME.shapeById[e.shapeId].cellCount}格 · ${TIER_NAME[e.tier]}${elder ? ` · ${elder}` : ''}`
}
function follow(id: number | null | undefined) {
  const eq = id ? GAME.equipById[id] : null
  Object.assign(filters, { element: eq?.element ?? 0, cells: eq ? GAME.shapeById[eq.shapeId].cellCount : 0, tier: eq?.tier ?? 0, form: eq?.weaponForm ?? -1 })
  keyword.value = ''
}
watch(() => props.modelValue ?? props.suggestedId, follow, { immediate: true })
const options = computed(() => equips.filter((e) => (!filters.element || e.element === filters.element)
  && (!filters.cells || GAME.shapeById[e.shapeId].cellCount === filters.cells)
  && (!filters.tier || e.tier === filters.tier) && (filters.form < 0 || e.weaponForm === filters.form)
  && `${e.name} ${e.elderId !== undefined ? GAME.elderById[e.elderId]?.name : ''}`.includes(keyword.value.trim()))
  .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN') || a.tier - b.tier))
const currentOutside = computed(() => props.modelValue && !options.value.some((e) => e.id === props.modelValue))
</script>

<template>
  <div class="review-picker">
    <div class="filters">
      <label>元素<select v-model.number="filters.element" aria-label="核对元素"><option :value="0">全部</option><option v-for="n in ELEMENTS" :key="n" :value="n">{{ ELEMENT_NAME[n] }}</option></select></label>
      <label>占格<select v-model.number="filters.cells" aria-label="核对占格"><option :value="0">全部</option><option v-for="n in CELL_COUNTS" :key="n" :value="n">{{ n }}格</option></select></label>
      <label>品阶<select v-model.number="filters.tier" aria-label="核对品阶"><option :value="0">全部</option><option v-for="n in TIERS" :key="n" :value="n">{{ TIER_NAME[n] }}</option></select></label>
      <label>形态<select v-model.number="filters.form" aria-label="核对形态"><option :value="-1">全部</option><option v-for="n in FORMS" :key="n" :value="n">{{ FORM_NAME[n] }}</option></select></label>
    </div>
    <div class="row"><button type="button" class="small" @click="follow(modelValue ?? suggestedId)">按当前候选筛选</button><button type="button" class="small ghost" @click="follow(null)">清空筛选</button><span class="muted small">{{ options.length }} 个可选</span></div>
    <label>名称 / 长老<input v-model="keyword" placeholder="在筛选结果中查找" /></label>
    <label>具体法宝<select :value="modelValue ?? ''" aria-label="具体法宝" @change="emit('update:modelValue', +($event.target as HTMLSelectElement).value)">
      <option value="" disabled>请选择法宝</option>
      <option v-if="currentOutside && modelValue" :value="modelValue">当前：{{ label(modelValue) }}（不在筛选内）</option>
      <option v-for="e in options" :key="e.id" :value="e.id">{{ label(e.id) }}</option>
    </select></label>
    <p v-if="!options.length" class="warn small">暂无匹配，请放宽筛选条件。</p>
  </div>
</template>

<style scoped>
.review-picker { display: grid; gap: 9px; min-width: 0; }
.filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; min-width: 0; }
select, input { width: 100%; min-width: 0; }
p { margin: 0; }
</style>
