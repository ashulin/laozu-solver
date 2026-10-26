<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEldersStore } from '@/stores/elders'
import ElderCard from '@/components/elders/ElderCard.vue'
import ElderFilterBar, { type ElderFilter } from '@/components/elders/ElderFilterBar.vue'
import BackupPanel from '@/components/elders/BackupPanel.vue'

const elders = useEldersStore()
const filter = ref<ElderFilter>({ keyword: '', qualities: [], ownedOnly: false })

const list = computed(() => {
  const kw = filter.value.keyword.trim()
  return elders.views
    .filter((v) => (!filter.value.qualities.length || filter.value.qualities.includes(v.elder.quality))
      && (!filter.value.ownedOnly || v.config.owned)
      && (!kw || v.elder.name.includes(kw) || v.redEquip.name.includes(kw)))
    .sort((a, b) => Number(b.config.owned) - Number(a.config.owned) || b.elder.quality - a.elder.quality || a.redEquip.element - b.redEquip.element)
})
</script>

<template>
  <div class="elders-page">
    <section class="panel">
      <h2>长老管理 <span class="muted small">账号级配置：星级决定红装三围与可携带数量，觉醒上限决定红装最多觉醒到几级</span></h2>
      <ElderFilterBar v-model="filter" :total="elders.views.length" :shown="list.length" :owned="elders.ownedCount" />
    </section>
    <div class="grid">
      <ElderCard v-for="v in list" :key="v.elder.id" :view="v" />
    </div>
    <p v-if="!list.length" class="muted">没有匹配的长老。</p>
    <BackupPanel />
  </div>
</template>

<style scoped>
.elders-page { display: flex; flex-direction: column; gap: 12px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 10px; }
</style>
