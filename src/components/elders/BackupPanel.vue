<script setup lang="ts">
import { ref } from 'vue'
import { GAME } from '@/core/data'
import { exportBackup, parseBackup, SECTION_LABEL, type SectionName, type Sections } from '@/services/storage'
import { toast } from '@/composables/toast'
import { useBagStore } from '@/stores/bag'
import { useBoardsStore } from '@/stores/boards'
import { useEldersStore } from '@/stores/elders'
import { useSettingsStore } from '@/stores/settings'

const elders = useEldersStore()
const bag = useBagStore()
const settings = useSettingsStore()
const boards = useBoardsStore()

const pending = ref<{ text: string; available: SectionName[] } | null>(null)
const picked = ref<SectionName[]>([])

function doExport() {
  const text = exportBackup({
    elders: elders.allConfigs,
    bag: { selected: bag.selected, lockedCells: bag.lockedCells, previousLayout: bag.previousLayout },
    settings: settings.$state,
    savedBoards: boards.boards,
  })
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `laozu-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  toast('备份已导出', 'ok')
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const text = await file.text()
  const r = parseBackup(text, GAME)
  if (!r.ok) {
    toast(r.error, 'warn', 4000)
    return
  }
  pending.value = { text, available: r.available }
  picked.value = r.available.includes('elders') ? ['elders'] : [...r.available]
}

function applySections(s: Partial<Sections>) {
  if (s.elders) elders.replaceAll(s.elders)
  if (s.bag) bag.$patch((st) => Object.assign(st, s.bag))
  if (s.settings) settings.replaceAll(s.settings)
  if (s.savedBoards) boards.replaceAll(s.savedBoards)
}

function confirmImport() {
  if (!pending.value) return
  const r = parseBackup(pending.value.text, GAME, picked.value)
  if (!r.ok) {
    toast(r.error, 'warn', 4000)
    return
  }
  applySections(r.sections)
  toast(`已导入：${picked.value.map((k) => SECTION_LABEL[k]).join('、')}`, 'ok')
  pending.value = null
}
</script>

<template>
  <section class="panel backup">
    <h2>备份</h2>
    <p class="muted small">数据只保存在本浏览器。换设备、换浏览器或清缓存前，请先导出备份。</p>
    <div class="row">
      <button type="button" @click="doExport">导出备份</button>
      <label class="file-btn">
        <input type="file" accept="application/json,.json" hidden @change="onFile" />
        <span>导入备份…</span>
      </label>
    </div>

    <div v-if="pending" class="import-box">
      <div class="small">选择要导入的内容（会覆盖本地对应数据）：</div>
      <label v-for="k in pending.available" :key="k" class="row small">
        <input v-model="picked" type="checkbox" :value="k" />{{ SECTION_LABEL[k] }}
      </label>
      <div class="row">
        <button type="button" class="primary" :disabled="!picked.length" @click="confirmImport">确认导入</button>
        <button type="button" class="ghost" @click="pending = null">取消</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.backup { display: flex; flex-direction: column; gap: 8px; }
.backup h2 { margin-bottom: 0; }
.file-btn span {
  display: inline-block;
  border: 1px solid var(--line);
  background: var(--bg-hover);
  border-radius: 8px;
  padding: 5px 12px;
  cursor: pointer;
}
.file-btn span:hover { border-color: var(--gold); }
.import-box { border: 1px dashed var(--line); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
</style>
