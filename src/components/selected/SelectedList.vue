<script setup lang="ts">
import { computed } from 'vue'
import { GAME } from '@/core/data'
import { ELEMENT_NAME } from '@/core/types'
import { useBagStore } from '@/stores/bag'
import { useEldersStore } from '@/stores/elders'
import ElderTag from '@/components/common/ElderTag.vue'
import { toast } from '@/composables/toast'

const bag = useBagStore()
const elders = useEldersStore()

const rows = computed(() => bag.selected.map((it) => {
  const eq = GAME.equipById[it.equipId]
  const shape = GAME.shapeById[eq.shapeId]
  const cap = eq.elderId !== undefined ? elders.config(eq.elderId).awakenCap : 0
  const hasAwaken = eq.elderId !== undefined && !!GAME.awakenDb[eq.id]
  return { it, eq, cells: shape.cellCount * it.copies.length, cap, hasAwaken }
}))

function plus(equipId: number) {
  const r = bag.add(equipId)
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
      <li v-for="r in rows" :key="r.it.equipId" class="item">
        <div class="row">
          <span class="tier" :style="{ background: `var(--tier-${r.eq.tier})` }">{{ r.eq.tier }}</span>
          <b>{{ r.eq.name }}</b>
          <span class="muted small">{{ ELEMENT_NAME[r.eq.element] }} · ×{{ r.it.copies.length }} · {{ r.cells }}格</span>
          <ElderTag :equip-id="r.eq.id" compact />
          <span class="ops">
            <button type="button" class="ghost small" aria-label="减少一件" @click="bag.removeCopy(r.it.equipId)">−</button>
            <button type="button" class="ghost small" aria-label="增加一件" @click="plus(r.it.equipId)">+</button>
            <button type="button" class="ghost small" @click="bag.removeItem(r.it.equipId)">移除</button>
          </span>
        </div>
        <div v-if="r.hasAwaken" class="row copies">
          <label v-for="(c, i) in r.it.copies" :key="i" class="small">
            第{{ i + 1 }}件
            <select :value="c.awaken" :aria-label="`第${i + 1}件觉醒`" @change="bag.setCopyAwaken(r.it.equipId, i, +($event.target as HTMLSelectElement).value)">
              <option v-for="lv in r.cap + 1" :key="lv" :value="lv - 1">{{ lv === 1 ? '未觉醒' : `觉醒${lv - 1}` }}</option>
            </select>
          </label>
          <span v-if="r.cap === 0" class="muted small">长老觉醒上限为 0，可在「长老管理」中调整</span>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.selected { display: flex; flex-direction: column; gap: 8px; }
.clear { margin-left: auto; }
.warns { margin: 0; padding-left: 18px; }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 420px; overflow: auto; }
.item { border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; background: var(--bg); }
.tier { width: 18px; height: 18px; border-radius: 4px; color: #fff; font-size: 11px; display: inline-grid; place-items: center; font-weight: 700; }
.ops { margin-left: auto; display: inline-flex; gap: 2px; }
.copies { margin-top: 4px; padding-left: 24px; gap: 10px; }
.copies select { padding: 1px 4px; }
</style>
