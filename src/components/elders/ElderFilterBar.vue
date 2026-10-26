<script setup lang="ts">
import { computed } from 'vue'
import { GAME } from '@/core/data'
import { elderFacetCounts, emptyElderFilter, type ElderFilter } from '@/core/elder-filter'
import { ELDER_QUALITIES, ELDER_QUALITY_NAME, ELEMENT_NAME, ELEMENTS, FORM_NAME, FORMS } from '@/core/types'
import type { ElderView } from '@/stores/elders'

const model = defineModel<ElderFilter>({ required: true })
const props = defineProps<{ views: ElderView[]; shown: number; owned: number }>()

const counts = computed(() => elderFacetCounts(GAME, props.views, model.value))
const forms = FORMS.filter((f) => f !== 0)
const active = computed(() => {
  const f = model.value
  return !!(f.keyword.trim() || f.qualities.length || f.elements.length || f.forms.length || f.ownedOnly)
})

type Dim = 'qualities' | 'elements' | 'forms'
function toggle<K extends Dim>(key: K, v: ElderFilter[K][number]) {
  const list = model.value[key] as unknown[]
  model.value = { ...model.value, [key]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] }
}
</script>

<template>
  <div class="filter">
    <div class="row">
      <input
        :value="model.keyword"
        type="search"
        maxlength="20"
        placeholder="搜索长老名 / 法宝名"
        aria-label="搜索长老"
        @input="model = { ...model, keyword: ($event.target as HTMLInputElement).value }"
      />
      <label class="chip" :class="{ on: model.ownedOnly }">
        <input type="checkbox" :checked="model.ownedOnly" hidden @change="model = { ...model, ownedOnly: !model.ownedOnly }" />只看已拥有
      </label>
      <button v-if="active" type="button" class="ghost small" @click="model = emptyElderFilter()">清空筛选</button>
      <span class="muted small count">已拥有 {{ owned }} / {{ views.length }} · 显示 {{ shown }}</span>
    </div>
    <div class="row dim">
      <span class="lab">品级</span>
      <span
        v-for="q in ELDER_QUALITIES" :key="q" class="chip" :class="[`q${q}`, { on: model.qualities.includes(q) }]"
        @click="toggle('qualities', q)"
      ><i class="dot" />{{ ELDER_QUALITY_NAME[q] }}<small>{{ counts.qualities[q] ?? 0 }}</small></span>
    </div>
    <div class="row dim">
      <span class="lab">元素</span>
      <span
        v-for="e in ELEMENTS" :key="e" class="chip" :class="{ on: model.elements.includes(e) }"
        :style="{ '--c': `var(--el-${e})` }" @click="toggle('elements', e)"
      ><i class="dot" />{{ ELEMENT_NAME[e] }}<small>{{ counts.elements[e] ?? 0 }}</small></span>
    </div>
    <div class="row dim">
      <span class="lab">形态</span>
      <span v-for="w in forms" :key="w" class="chip" :class="{ on: model.forms.includes(w) }" @click="toggle('forms', w)">
        {{ FORM_NAME[w] }}<small>{{ counts.forms[w] ?? 0 }}</small>
      </span>
    </div>
  </div>
</template>

<style scoped>
.filter { display: flex; flex-direction: column; gap: 6px; }
.filter input[type='search'] { width: 180px; }
.count { margin-left: auto; }
.dim { gap: 4px; }
.lab { width: 32px; color: var(--text-dim); font-size: 12px; }
.chip small { color: var(--text-dim); margin-left: 2px; }
.chip.on small { color: inherit; opacity: 0.8; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); display: inline-block; }
.q4 { --c: var(--gold); }
.q3 { --c: #ce93d8; }
.q2 { --c: #64b5f6; }
</style>
