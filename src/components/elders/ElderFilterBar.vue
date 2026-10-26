<script lang="ts">
export interface ElderFilter {
  keyword: string
  qualities: number[]
  ownedOnly: boolean
}
</script>

<script setup lang="ts">
const model = defineModel<ElderFilter>({ required: true })
defineProps<{ total: number; shown: number; owned: number }>()

const QUALITIES = [
  { q: 4, label: '黄' },
  { q: 3, label: '紫' },
  { q: 2, label: '蓝' },
]
function toggle(q: number) {
  const list = model.value.qualities
  model.value = { ...model.value, qualities: list.includes(q) ? list.filter((x) => x !== q) : [...list, q] }
}
</script>

<template>
  <div class="row filter">
    <input
      :value="model.keyword"
      type="search"
      maxlength="20"
      placeholder="搜索长老名 / 法宝名"
      aria-label="搜索长老"
      @input="model = { ...model, keyword: ($event.target as HTMLInputElement).value }"
    />
    <span v-for="it in QUALITIES" :key="it.q" class="chip" :class="{ on: model.qualities.includes(it.q) }" @click="toggle(it.q)">{{ it.label }}</span>
    <label class="chip" :class="{ on: model.ownedOnly }">
      <input type="checkbox" :checked="model.ownedOnly" hidden @change="model = { ...model, ownedOnly: !model.ownedOnly }" />只看已拥有
    </label>
    <span class="muted small count">已拥有 {{ owned }} / {{ total }} · 显示 {{ shown }}</span>
  </div>
</template>

<style scoped>
.filter input[type='search'] { width: 180px; }
.count { margin-left: auto; }
</style>
