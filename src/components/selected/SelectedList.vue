<script setup lang="ts">
import { computed } from 'vue'
import { GAME } from '@/core/data'
import { compareSelected } from '@/core/catalog'
import { ELEMENT_NAME, FORM_NAME, type Equip } from '@/core/types'
import { useBagStore } from '@/stores/bag'
import { useEldersStore } from '@/stores/elders'
import ElderTag from '@/components/common/ElderTag.vue'
import { toast } from '@/composables/toast'

const bag = useBagStore()
const elders = useEldersStore()

/** 同名同占格的下一阶（普通法宝才能升阶） */
function nextTier(eq: Equip): Equip | null {
  if (eq.elderId !== undefined) return null
  return GAME.equips.find((e) => e.name === eq.name && e.shapeId === eq.shapeId && e.tier === eq.tier + 1) ?? null
}

/** 已选列表逐件平铺：每一件都有自己的一行与操作按钮，不再按法宝合并 */
const rows = computed(() => bag.selected.flatMap((it) => {
  const eq = GAME.equipById[it.equipId]
  const cap = eq.elderId !== undefined ? elders.config(eq.elderId).awakenCap : 0
  const hasAwaken = eq.elderId !== undefined && !!GAME.awakenDb[eq.id]
  return it.copies.map((copy, index) => ({
    key: copy.id ?? `${it.equipId}-${index}`,
    equipId: it.equipId,
    copyId: copy.id,
    copyIndex: index,
    it: { equipId: it.equipId, copies: [copy] },
    eq,
    awaken: copy.awaken,
    cells: GAME.shapeById[eq.shapeId].cellCount,
    cap,
    hasAwaken,
    next: nextTier(eq),
  }))
}).sort((a, b) => compareSelected(GAME, a, b)))

function plus(equipId: number) {
  const r = bag.add(equipId)
  if (!r.ok) toast(r.reason, 'warn', 3500)
}

function upgrade(equipId: number, copyId: string | undefined, next: Equip | null) {
  if (!copyId || !next) return
  const r = bag.setCopyTier(equipId, copyId, next.tier)
  if (!r.ok) toast(r.reason, 'warn', 3500)
}
</script>

<template>
  <section class="panel selected">
    <h2>
      已选法宝
      <span class="muted small">{{ bag.totalPieces }} 件 · {{ bag.totalCells }} / {{ bag.usableCells }} 格</span>
      <button v-if="bag.selected.length" type="button" class="ghost small clear" @click="bag.clear()">清空</button>
    </h2>
    <ul v-if="bag.warnings.length" class="warns">
      <li v-for="w in bag.warnings" :key="w" class="warn small">{{ w }}</li>
    </ul>
    <p v-if="bag.totalCells > bag.usableCells" class="warn small">法宝共需 {{ bag.totalCells }} 格，超过可用的 {{ bag.usableCells }} 格，求解时会舍弃部分法宝。</p>
    <p v-if="!bag.selected.length" class="muted small">还没有添加法宝，去目录里选择，或使用「截图识别」导入。</p>
    <ul class="list">
      <li v-for="r in rows" :key="r.key" class="item row">
        <span class="tier" :style="{ background: `var(--tier-${r.eq.tier})` }" :title="`${r.eq.tier} 阶`" aria-hidden="true" />
        <div class="meta">
          <b>{{ r.eq.name }}</b>
          <span class="muted small">{{ ELEMENT_NAME[r.eq.element] }}<template v-if="r.cells > 1 && r.eq.weaponForm !== 0"> · {{ FORM_NAME[r.eq.weaponForm] }}</template> · {{ r.cells }}格</span>
          <ElderTag :equip-id="r.eq.id" compact />
        </div>
        <select
          v-if="r.hasAwaken" class="awaken" :value="r.awaken" :aria-label="`${r.eq.name}觉醒等级`"
          @change="bag.setCopyAwaken(r.equipId, r.copyIndex, +($event.target as HTMLSelectElement).value)"
        >
          <option v-for="lv in r.cap + 1" :key="lv" :value="lv - 1">{{ lv === 1 ? '未觉醒' : `觉醒${lv - 1}` }}</option>
        </select>
        <span class="ops">
          <button
            v-if="r.next" type="button" class="ghost small icon" :aria-label="`${r.eq.name}升一阶`"
            :title="`升为 ${r.next.tier} 阶`" @click="upgrade(r.equipId, r.copyId, r.next)"
          >↑</button>
          <button type="button" class="ghost small icon" :aria-label="`${r.eq.name}再加一件`" title="再加一件" @click="plus(r.equipId)">＋</button>
          <button type="button" class="ghost small icon" :aria-label="`删除这件${r.eq.name}`" title="删除这一件" @click="bag.removeCopy(r.equipId, r.copyId ?? r.copyIndex)">−</button>
        </span>
      </li>
    </ul>
    <p v-if="rows.some((r) => r.hasAwaken && r.cap === 0)" class="muted small">长老觉醒为 0，可在「长老管理」中调整</p>
  </section>
</template>

<style scoped>
.selected { display: flex; flex-direction: column; gap: 8px; }
.clear { margin-left: auto; }
.warns { margin: 0; padding-left: 18px; }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 460px; overflow: auto; }
.item { border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; background: var(--bg); gap: 8px; align-items: center; flex-wrap: wrap; }
.tier { width: 18px; height: 18px; border-radius: 4px; flex-shrink: 0; }
.meta { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; min-width: 0; }
.meta b { font-size: 13px; }
.awaken { padding: 1px 4px; }
.ops { margin-left: auto; display: inline-flex; gap: 4px; }
.ops .icon { width: 24px; min-width: 24px; height: 24px; padding: 0; font-size: 14px; line-height: 1; }
</style>
