<script setup lang="ts">
import EquipCatalog from '@/components/catalog/EquipCatalog.vue'
import SelectedList from '@/components/selected/SelectedList.vue'
import BoardPanel from '@/components/board/BoardPanel.vue'
import SolveSettings from '@/components/settings/SolveSettings.vue'
import SolveLog from '@/components/log/SolveLog.vue'
</script>

<template>
  <div class="solver-page">
    <div class="col left">
      <EquipCatalog />
      <SelectedList />
    </div>
    <div class="col right">
      <BoardPanel />
      <SolveSettings />
      <SolveLog />
    </div>
  </div>
</template>

<style scoped>
.solver-page { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 12px; align-items: start; }
.col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
@media (max-width: 900px) {
  .solver-page { grid-template-columns: 1fr; }
  .right { order: -1; }
}
</style>
