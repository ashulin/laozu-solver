<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { GAME } from '@/core/data'
import { buildCatalog, defaultTierOf, filterCatalog, type CatalogEntry } from '@/core/catalog'
import { A_ATK, A_DEF, A_HP } from '@/core/solver/constants'
import { ELEMENT_NAME, FORM_NAME, type Tier } from '@/core/types'
import { toast } from '@/composables/toast'
import { useBagStore } from '@/stores/bag'
import { useEldersStore } from '@/stores/elders'
import { useSettingsStore } from '@/stores/settings'
import ElderTag from '@/components/common/ElderTag.vue'
import ShapePreview from '@/components/common/ShapePreview.vue'
import CatalogFilterBar from './CatalogFilterBar.vue'

const PAGE = 60
const catalog = buildCatalog(GAME)
const settings = useSettingsStore()
const bag = useBagStore()
const elders = useEldersStore()

const limit = ref(PAGE)
const tierPick = reactive<Record<string, Tier>>({})
const qtyPick = reactive<Record<string, number>>({})
const openDesc = ref<string | null>(null)

const list = computed(() => filterCatalog(catalog, settings.catalogFilters))
const tierOf = (e: CatalogEntry): Tier => tierPick[e.name] ?? defaultTierOf(e, settings.catalogFilters)
const equipOf = (e: CatalogEntry) => e.tiers.find((t) => t.tier === tierOf(e)) ?? e.tiers[e.tiers.length - 1]
const base = (e: CatalogEntry, attr: number) => equipOf(e).base.find((b) => b.attr === attr)?.value ?? 0
const isLockedRed = (e: CatalogEntry) => !!e.elder && equipOf(e).elderId !== undefined && !elders.config(e.elder.id).owned

function add(e: CatalogEntry) {
  const eq = equipOf(e)
  const r = bag.add(eq.id, qtyPick[e.name] ?? 1)
  if (r.ok) toast(`已添加 ${eq.name}·${eq.tier}阶 ×${qtyPick[e.name] ?? 1}`, 'ok', 1500)
  else toast(r.reason, 'warn', 3500)
}
function skillText(e: CatalogEntry) {
  const eq = equipOf(e)
  const skills = eq.skillIds.map((id) => GAME.skillById[id]?.desc).filter(Boolean)
  return eq.desc + (skills.length ? `\n\n技能：${skills.join('\n')}` : '')
}
</script>

<template>
  <section class="panel catalog">
    <h2>法宝目录</h2>
    <CatalogFilterBar :entries="catalog" :shown="list.length" />
    <ul class="list">
      <li v-for="e in list.slice(0, limit)" :key="e.name" class="item" :class="{ dim: isLockedRed(e) }">
        <div class="top">
          <span class="name">{{ e.name }}</span>
          <ElderTag v-if="e.elder" :equip-id="e.elder.redEquipId" compact />
          <span class="badge" :style="{ background: `var(--el-${e.element})` }">{{ ELEMENT_NAME[e.element] }}{{ FORM_NAME[e.weaponForm] }}</span>
          <ShapePreview :shape="e.shape" :tier="tierOf(e)" />
        </div>
        <div class="meta muted small">
          {{ e.cellCount }}格 · 攻{{ base(e, A_ATK) }} 防{{ base(e, A_DEF) }} 血{{ base(e, A_HP) }}
        </div>
        <div class="ctrl row">
          <select v-if="e.tiers.length > 1" :value="tierOf(e)" aria-label="品阶" @change="tierPick[e.name] = +($event.target as HTMLSelectElement).value as Tier">
            <option v-for="t in e.tiers" :key="t.id" :value="t.tier">{{ t.tier }}阶</option>
          </select>
          <span v-else class="small muted">{{ e.tiers[0].tier }}阶</span>
          <input v-model.number="qtyPick[e.name]" type="number" min="1" max="42" placeholder="1" class="qty" aria-label="数量" />
          <button type="button" class="small" @click="add(e)">添加</button>
          <button type="button" class="ghost small" @click="openDesc = openDesc === e.name ? null : e.name">{{ openDesc === e.name ? '收起' : '效果' }}</button>
        </div>
        <p v-if="openDesc === e.name" class="desc small">{{ skillText(e) }}</p>
      </li>
    </ul>
    <p v-if="!list.length" class="muted">没有匹配的法宝。</p>
    <button v-if="list.length > limit" type="button" class="ghost more" @click="limit += PAGE">显示更多（还有 {{ list.length - limit }} 种）</button>
  </section>
</template>

<style scoped>
.catalog { display: flex; flex-direction: column; gap: 10px; }
.list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 8px; max-height: 560px; overflow: auto; }
.item { border: 1px solid var(--line); border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 4px; background: var(--bg); }
.item.dim { opacity: 0.6; }
.top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.name { font-weight: 600; }
.badge { font-size: 11px; color: #fff; border-radius: 5px; padding: 0 5px; line-height: 17px; }
.top :deep(.shape) { margin-left: auto; }
.qty { width: 52px; }
.desc { white-space: pre-wrap; margin: 0; color: var(--text-dim); }
.more { align-self: center; }
</style>
