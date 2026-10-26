<script setup lang="ts">
/**
 * 弟子天赋两级选择器：一级选「无 / 剑 / 乐 / … / 幡」，二级选该形态下的具体天赋。
 * 其它槽位已选的天赋置灰（同一天赋重复选择只算一次）。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { GAME } from '@/core/data'
import { talentDesc, talentGroups } from '@/core/talents'
import { FORM_NAME, type WeaponForm } from '@/core/types'

const props = withDefaults(defineProps<{ label: string; disabledIds?: (number | null)[] }>(), { disabledIds: () => [] })
const model = defineModel<number | null>({ required: true })

const groups = talentGroups(GAME)
const PANEL_WIDTH = 420

const root = ref<HTMLElement | null>(null)
const open = ref(false)
const alignRight = ref(false)
const activeForm = ref<WeaponForm>(groups[0].form)

const current = computed(() => (model.value === null ? null : (GAME.talentById[model.value] ?? null)))
const activeGroup = computed(() => groups.find((g) => g.form === activeForm.value) ?? groups[0])
const taken = computed(() => new Set(props.disabledIds.filter((x): x is number => x !== null && x !== model.value)))
const pct = (v: number) => `+${v / 100}%`

function toggle() {
  if (open.value) return close()
  if (current.value) activeForm.value = current.value.form
  const rect = root.value?.getBoundingClientRect()
  alignRight.value = !!rect && rect.left + PANEL_WIDTH > window.innerWidth - 8
  open.value = true
  nextTick(() => root.value?.querySelector<HTMLElement>('.forms .on')?.focus())
}
function close() {
  open.value = false
}
function pick(id: number | null) {
  model.value = id
  close()
  root.value?.querySelector<HTMLElement>('.trigger')?.focus()
}

function onDocPointer(e: PointerEvent) {
  if (root.value && !root.value.contains(e.target as Node)) close()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    pick(model.value)
  }
}
watch(open, (o) => {
  if (o) document.addEventListener('pointerdown', onDocPointer, true)
  else document.removeEventListener('pointerdown', onDocPointer, true)
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointer, true))
</script>

<template>
  <div ref="root" class="talent-picker" @keydown="onKey">
    <button
      type="button"
      class="trigger"
      :class="{ empty: !current }"
      :aria-label="label"
      aria-haspopup="true"
      :aria-expanded="open"
      :title="current ? current.desc : ''"
      @click="toggle"
    >
      <template v-if="current">
        <span class="form-tag">{{ FORM_NAME[current.form] }}</span>
        <span class="name">{{ current.name }}</span>
        <span class="val">{{ pct(current.value) }}</span>
      </template>
      <span v-else class="muted">{{ label }}：无</span>
      <span class="caret" aria-hidden="true">▾</span>
    </button>

    <div v-if="open" class="panel" :class="{ right: alignRight }" role="dialog" :aria-label="`选择${label}`">
      <ul class="forms" role="listbox" aria-label="武器形态">
        <li>
          <button type="button" class="form-btn none" :class="{ sel: !current }" @click="pick(null)">无</button>
        </li>
        <li v-for="g in groups" :key="g.form">
          <button
            type="button"
            class="form-btn"
            :class="{ on: g.form === activeForm, sel: current?.form === g.form }"
            @click="activeForm = g.form"
            @mouseenter="activeForm = g.form"
            @focus="activeForm = g.form"
          >
            {{ FORM_NAME[g.form] }}<small>{{ g.talents.length }}</small>
          </button>
        </li>
      </ul>
      <ul class="talents" role="listbox" :aria-label="`${FORM_NAME[activeGroup.form]}形态天赋`">
        <li v-for="t in activeGroup.talents" :key="t.id">
          <button
            type="button"
            class="talent-btn"
            :class="{ sel: t.id === model }"
            :disabled="taken.has(t.id)"
            role="option"
            :aria-selected="t.id === model"
            @click="pick(t.id)"
          >
            <span class="row1">
              <b>{{ t.name }}</b>
              <span class="val">{{ pct(t.value) }}</span>
              <span v-if="taken.has(t.id)" class="muted small">其它槽位已选</span>
            </span>
            <span class="desc">{{ talentDesc(t) }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.talent-picker { position: relative; min-width: 0; }
.trigger {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  text-align: left;
  background: var(--bg);
  border-radius: 6px;
  padding: 4px 8px;
  min-height: 30px;
}
.trigger .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trigger.empty > .muted { flex: 1; }
.form-tag { font-size: 11px; color: var(--gold); border: 1px solid var(--gold); border-radius: 4px; padding: 0 4px; line-height: 16px; }
.val { color: var(--ok); font-size: 12px; font-variant-numeric: tabular-nums; }
.caret { color: var(--text-dim); font-size: 11px; }

.panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 30;
  width: min(420px, 92vw);
  max-height: 320px;
  display: grid;
  grid-template-columns: 76px 1fr;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.panel.right { left: auto; right: 0; }
ul { list-style: none; margin: 0; padding: 4px; overflow: auto; }
.forms { border-right: 1px solid var(--line); background: var(--bg-panel); }
.form-btn, .talent-btn { width: 100%; border: 0; background: transparent; text-align: left; border-radius: 6px; }
.form-btn { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; }
.form-btn small { color: var(--text-dim); font-size: 11px; }
.form-btn.on { background: var(--gold-weak); color: var(--gold); }
.form-btn.sel::after { content: '•'; color: var(--gold); margin-left: 4px; }
.form-btn.none.sel { color: var(--gold); }
.talent-btn { display: flex; flex-direction: column; gap: 1px; padding: 6px 8px; }
.talent-btn:hover:not(:disabled), .form-btn:hover { background: var(--bg-hover); }
.talent-btn.sel { background: var(--gold-weak); }
.talent-btn.sel b { color: var(--gold); }
.row1 { display: flex; align-items: center; gap: 6px; }
.desc { font-size: 12px; color: var(--text-dim); }
</style>
