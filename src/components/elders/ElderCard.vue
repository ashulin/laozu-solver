<script setup lang="ts">
import { computed, ref } from 'vue'
import { GAME } from '@/core/data'
import { describeAwakenLevels } from '@/core/awaken-text'
import { A_ATK, A_DEF, A_HP } from '@/core/solver/constants'
import { effBase, starBonusOf } from '@/core/solver/eff-base'
import { maxRedCopies } from '@/core/solver/red-rules'
import { ELEMENT_NAME, FORM_NAME } from '@/core/types'
import { useEldersStore, type ElderView } from '@/stores/elders'
import ShapePreview from '@/components/common/ShapePreview.vue'
import Stepper from '@/components/common/Stepper.vue'

const props = defineProps<{ view: ElderView }>()
const elders = useEldersStore()
const open = ref(false)

const eq = computed(() => props.view.redEquip)
const shape = computed(() => GAME.shapeById[eq.value.shapeId])
// 配置从 store 实时读取，不依赖 props 快照
const cfg = computed(() => elders.config(props.view.elder.id))
const maxCopies = computed(() => maxRedCopies(cfg.value))

const star = computed({ get: () => cfg.value.star, set: (v) => elders.setStar(props.view.elder.id, v) })
const cap = computed({ get: () => cfg.value.awakenCap, set: (v) => elders.setAwakenCap(props.view.elder.id, v) })
const owned = computed({ get: () => cfg.value.owned, set: (v) => elders.setOwned(props.view.elder.id, v) })

const stats = computed(() => {
  const input = { elder: props.view.elder, star: cfg.value.star, awaken: cfg.value.awakenCap, talentMap: {}, awakenDb: GAME.awakenDb }
  return [A_ATK, A_DEF, A_HP].map((a) => effBase(eq.value, a, input))
})
const bonus = computed(() => starBonusOf(props.view.elder, cfg.value.star) / 100)
const levels = computed(() => (props.view.awaken ? describeAwakenLevels(props.view.awaken, GAME) : []))
const fmt = (n: number) => n.toLocaleString('zh-CN')
</script>

<template>
  <article class="elder-card" :class="[`q${view.elder.quality}`, { owned: cfg.owned }]">
    <header class="head">
      <label class="own">
        <input v-model="owned" type="checkbox" :aria-label="`拥有${view.elder.name}`" />
        <span class="name">{{ view.elder.name }}</span>
      </label>
      <span class="equip">
        <ShapePreview :shape="shape" :tier="5" :size="6" />
        <span>{{ eq.name }}</span>
        <span class="muted small">{{ ELEMENT_NAME[eq.element] }}·{{ FORM_NAME[eq.weaponForm] }}·{{ shape.cellCount }}格</span>
      </span>
    </header>

    <div class="row ctrl">
      <span class="lab">星级</span>
      <Stepper v-model="star" :max="5" label="星级" />
      <span class="muted small">{{ bonus ? `基础三围 +${bonus}%` : '无星级加成' }} · 可带 {{ maxCopies }} 件</span>
    </div>
    <div class="row ctrl">
      <span class="lab">觉醒上限</span>
      <template v-if="view.awaken">
        <Stepper v-model="cap" :max="view.maxCap" label="觉醒上限" />
        <button type="button" class="ghost small" @click="open = !open">{{ open ? '收起效果' : '查看效果' }}</button>
      </template>
      <span v-else class="danger small">觉醒数据缺失，按无觉醒计算</span>
    </div>
    <div class="muted small stats">
      ★{{ cfg.star }}<template v-if="view.awaken"> · 觉醒{{ cfg.awakenCap }}</template> 时：攻 {{ fmt(stats[0]) }} · 防 {{ fmt(stats[1]) }} · 血 {{ fmt(stats[2]) }}
    </div>
    <ol v-if="open && levels.length" class="levels">
      <li v-for="lv in levels" :key="lv.level" :class="{ on: lv.level <= cfg.awakenCap }">
        <b>觉醒{{ lv.level }}</b> {{ lv.lines.join('；') }}
      </li>
    </ol>
  </article>
</template>

<style scoped>
.elder-card {
  background: var(--bg-panel);
  border: 1px solid var(--line);
  border-left: 3px solid var(--q);
  border-radius: var(--radius);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  opacity: 0.72;
}
.elder-card.owned { opacity: 1; }
.q2 { --q: #64b5f6; }
.q3 { --q: #ce93d8; }
.q4 { --q: var(--gold); }
.head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.own { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.name { color: var(--q); font-weight: 700; font-size: 15px; }
.equip { display: inline-flex; align-items: center; gap: 6px; }
.ctrl { gap: 10px; }
.lab { width: 56px; color: var(--text-dim); font-size: 12px; }
.stats { font-variant-numeric: tabular-nums; }
.levels { margin: 0; padding-left: 18px; font-size: 12px; color: var(--text-dim); }
.levels li.on { color: var(--text); }
.levels b { color: #c9a0ff; font-weight: 600; margin-right: 4px; }
</style>
