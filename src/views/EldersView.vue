<script setup lang="ts">
import { computed, ref } from 'vue'
import { GAME } from '@/core/data'
import { emptyElderFilter, matchElder, type ElderFilter } from '@/core/elder-filter'
import { DEFAULT_ACCOUNT_NAME, useEldersStore } from '@/stores/elders'
import ElderCard from '@/components/elders/ElderCard.vue'
import ElderFilterBar from '@/components/elders/ElderFilterBar.vue'
import BackupPanel from '@/components/elders/BackupPanel.vue'

const elders = useEldersStore()
const filter = ref<ElderFilter>(emptyElderFilter())

const list = computed(() => elders.views
  .filter((v) => matchElder(GAME, v.elder, v.config, filter.value))
  .sort((a, b) => Number(b.config.owned) - Number(a.config.owned) || b.elder.quality - a.elder.quality || a.redEquip.element - b.redEquip.element))
</script>

<template>
  <div class="elders-page">
    <section class="panel">
      <h2>
        长老管理
        <span class="account" title="目前只有一个账号，暂不支持切换">账号：{{ DEFAULT_ACCOUNT_NAME }}</span>
        <span class="muted small">星级决定红装三围与可携带数量，觉醒决定红装最多可觉醒到几级</span>
      </h2>
      <ElderFilterBar v-model="filter" :views="elders.views" :shown="list.length" :owned="elders.ownedCount" />
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
.account { font-size: 12px; font-weight: 400; color: var(--gold); border: 1px solid var(--gold); border-radius: 10px; padding: 0 8px; margin: 0 6px; }
</style>
