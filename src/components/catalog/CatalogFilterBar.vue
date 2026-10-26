<script setup lang="ts">
import { computed } from 'vue'
import type { CatalogEntry } from '@/core/catalog'
import { facetCounts } from '@/core/catalog'
import { CELL_COUNTS, ELEMENT_NAME, ELEMENTS, FORM_NAME, FORMS, TIER_NAME, TIERS } from '@/core/types'
import { useSettingsStore } from '@/stores/settings'

const props = defineProps<{ entries: CatalogEntry[]; shown: number }>()
const settings = useSettingsStore()
const f = computed(() => settings.catalogFilters)
const counts = computed(() => facetCounts(props.entries, f.value))
</script>

<template>
  <div class="filter-bar">
    <div class="row">
      <input
        v-model="settings.catalogFilters.keyword"
        type="search"
        maxlength="20"
        placeholder="搜索法宝名 / 长老名"
        aria-label="搜索法宝"
      />
      <span class="muted small">{{ shown }} / {{ entries.length }} 种</span>
      <button v-if="settings.hasFilters" type="button" class="ghost small" @click="settings.clearFilters()">清空筛选</button>
    </div>
    <div class="row dim">
      <span class="lab">元素</span>
      <span
        v-for="e in ELEMENTS" :key="e" class="chip" :class="{ on: f.elements.includes(e) }"
        :style="{ '--c': `var(--el-${e})` }" @click="settings.toggleFilter('elements', e)"
      ><i class="dot" />{{ ELEMENT_NAME[e] }}<small>{{ counts.elements[e] ?? 0 }}</small></span>
    </div>
    <div class="row dim">
      <span class="lab">形态</span>
      <span v-for="w in FORMS" :key="w" class="chip" :class="{ on: f.forms.includes(w) }" @click="settings.toggleFilter('forms', w)">
        {{ FORM_NAME[w] }}<small>{{ counts.forms[w] ?? 0 }}</small>
      </span>
    </div>
    <div class="row dim">
      <span class="lab">占格</span>
      <span v-for="n in CELL_COUNTS" :key="n" class="chip" :class="{ on: f.cellCounts.includes(n) }" @click="settings.toggleFilter('cellCounts', n)">
        {{ n }}格<small>{{ counts.cellCounts[n] ?? 0 }}</small>
      </span>
    </div>
    <div class="row dim">
      <span class="lab">品阶</span>
      <span
        v-for="t in TIERS" :key="t" class="chip" :class="{ on: f.tiers.includes(t) }"
        :style="{ '--c': `var(--tier-${t})` }" @click="settings.toggleFilter('tiers', t)"
      ><i class="dot" />{{ TIER_NAME[t] }}<small>{{ counts.tiers[t] ?? 0 }}</small></span>
    </div>
  </div>
</template>

<style scoped>
.filter-bar { display: flex; flex-direction: column; gap: 6px; }
.filter-bar input[type='search'] { flex: 1; min-width: 160px; max-width: 260px; }
.dim { gap: 4px; }
.lab { width: 32px; color: var(--text-dim); font-size: 12px; }
.chip small { color: var(--text-dim); margin-left: 2px; }
.chip.on small { color: inherit; opacity: 0.8; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); display: inline-block; }
</style>
