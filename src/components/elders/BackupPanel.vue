<script setup lang="ts">
import { ref } from 'vue'
import { GAME } from '@/core/data'
import { exportBackup, JUEXING_EXPORT_SNIPPET, migrateFromJuexing, parseBackup, SECTION_LABEL, type SectionName, type Sections } from '@/services/storage'
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
const legacyText = ref('')
const showLegacy = ref(false)

function doExport() {
  const text = exportBackup({
    elders: Object.values(elders.configs),
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

function migrate() {
  const r = migrateFromJuexing(legacyText.value.trim(), GAME)
  if (!r.ok) {
    toast(r.error, 'warn', 4000)
    return
  }
  const { sections, notes } = r.result
  elders.replaceAll(sections.elders)
  bag.replaceSelected(sections.bag.selected)
  bag.lockedCells = sections.bag.lockedCells
  settings.replaceAll(sections.settings)
  toast(`迁移完成：${notes.join('；')}`, 'ok', 5000)
  legacyText.value = ''
  showLegacy.value = false
}
</script>

<template>
  <section class="panel backup">
    <h2>备份与迁移</h2>
    <p class="muted small">数据只保存在本浏览器。换设备、换浏览器或清缓存前，请先导出备份。</p>
    <div class="row">
      <button type="button" @click="doExport">导出备份</button>
      <label class="file-btn">
        <input type="file" accept="application/json,.json" hidden @change="onFile" />
        <span>导入备份…</span>
      </label>
      <button type="button" class="ghost" @click="showLegacy = !showLegacy">从觉醒版迁移</button>
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

    <div v-if="showLegacy" class="import-box">
      <ol class="small muted steps">
        <li>打开觉醒版页面（eleven-tz.github.io/laozu-solver-juexing）</li>
        <li>按 F12 打开控制台，运行：<code>{{ JUEXING_EXPORT_SNIPPET }}</code></li>
        <li>把复制出的内容粘贴到下面</li>
      </ol>
      <textarea v-model="legacyText" rows="4" maxlength="200000" placeholder="粘贴觉醒版数据" aria-label="觉醒版数据" />
      <div class="row">
        <button type="button" class="primary" :disabled="!legacyText.trim()" @click="migrate">迁移</button>
        <span class="muted small">会覆盖长老配置与已选法宝；觉醒版的觉醒等级会作为长老的觉醒上限</span>
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
.steps { margin: 0; padding-left: 18px; }
code { background: var(--bg); padding: 1px 6px; border-radius: 4px; color: var(--gold); user-select: all; }
textarea { width: 100%; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; color: var(--text); padding: 6px; font: 12px/1.4 ui-monospace, monospace; }
</style>
