<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { GAME } from '@/core/data'
import { ELEMENT_NAME, TIER_NAME } from '@/core/types'
import { occupiedCells, validGrid } from '@/core/ocr/geometry'
import { needsReview, rebuildCoverage, reviewRecognition, setExcluded } from '@/core/ocr/draft'
import { checkRedEquips } from '@/core/solver/red-rules'
import { extractSample, mergeSample, sampleDrift, type OcrSample } from '@/core/ocr/learn'
import type { RecognitionCell } from '@/core/ocr/recognize'
import { fromRgba, type Grid } from '@/core/ocr/sampling'
import { decodeScreenshot, runRecognition } from '@/services/recognition'
import { appStore } from '@/services/app-storage'
import { useBagStore } from '@/stores/bag'
import { useEldersStore } from '@/stores/elders'
import ElderCard from '@/components/elders/ElderCard.vue'
import ReviewEquipPicker from '@/components/recognize/ReviewEquipPicker.vue'
import ReviewBoard from '@/components/recognize/ReviewBoard.vue'
import { matchesReviewFilter, reviewFootprints, reviewTargets, reviewStatus, REVIEW_STATUS_NAME, type ReviewFilter } from '@/core/ocr/review-board'
import { useSolverStore } from '@/stores/solver'
import { useRouter } from 'vue-router'

const bag = useBagStore()
const elders = useEldersStore()
const solver = useSolverStore()
const router = useRouter()
const image = shallowRef<ImageData | null>(null)
const canvas = ref<HTMLCanvasElement>()
const thumb = ref<HTMLCanvasElement>()
const filename = ref('')
const busy = ref(false)
const status = ref('')
const error = ref('')
const imported = ref(false)
const cells = ref<RecognitionCell[]>([])
const grid = ref<Grid | null>(null)
const activeIndex = ref(0)
const skipPending = ref(false)
const listMode = ref<ReviewFilter>('pending')
// 没有待核对时默认收起核对编辑区；点击某一格会展开
const reviewOpen = ref(false)
// 一键导入时若仍有待核对，先弹出确认（确认后跳过它们直接导入）
const quickSkipPrompt = ref(false)
const mobileView = ref<'original' | 'recognized'>('recognized')
// 用户教过的样子：本次会话与下次打开都会参与识别
const samples = ref<OcrSample[]>(appStore().load('ocrSamples')?.samples ?? [])
const learnNote = ref('')
const learnedEquips = computed(() => new Set(samples.value.map((s) => s.equipId)).size)
const overlapCell = ref<number | null>(null)
const editor = ref<HTMLFieldSetElement>()
const elderBox = ref<HTMLDetailsElement>()
const footprints = computed(() => reviewFootprints(cells.value, skipPending.value))
const overlapChoices = computed(() => overlapCell.value === null ? [] : reviewTargets(footprints.value, overlapCell.value))
const canConfirm = computed(() => !!active.value && !active.value.excluded && active.value.kind !== 'unknown' && active.value.kind !== 'covered' && !active.value.conflicts?.length && (active.value.kind !== 'piece' || active.value.awaken !== null))
const framing = ref(false)
const showFull = ref(false)
const previewBounds = computed(() => {
  const img = image.value
  const g = grid.value
  if (img && g && !framing.value && !showFull.value && validGrid({ w: img.width, h: img.height }, g)) {
    const x = Math.max(0, Math.floor(g.ox)), y = Math.max(0, Math.floor(g.oy))
    return { x, y, w: Math.min(img.width - x, Math.round(g.pw * 7)), h: Math.min(img.height - y, Math.round(g.ph * 6)) }
  }
  return { x: 0, y: 0, w: img?.width ?? 1, h: img?.height ?? 1 }
})
const corner = ref<{ x: number; y: number } | null>(null)
let controller: AbortController | null = null
let revision = 0
const active = computed(() => cells.value[activeIndex.value])
const activeEquip = computed(() => active.value?.equipId ? GAME.equipById[active.value.equipId] : null)
const maxAwaken = computed(() => activeEquip.value ? GAME.awakenDb[activeEquip.value.id]?.maxLevel ?? 0 : 0)
const pending = needsReview
const groups = computed(() => {
  const all = cells.value.filter((c) => c.kind !== 'covered')
  return {
    pending: all.filter((c) => matchesReviewFilter(c, 'pending', skipPending.value)),
    conflict: all.filter((c) => matchesReviewFilter(c, 'conflict', skipPending.value)),
    ready: all.filter((c) => matchesReviewFilter(c, 'ready', skipPending.value)),
    excluded: all.filter((c) => matchesReviewFilter(c, 'excluded', skipPending.value)), all,
  }
})
const entries = computed(() => groups.value[listMode.value])
const pendingCount = computed(() => cells.value.filter(pending).length)
const lockedCount = computed(() => cells.value.filter((c) => c.kind === 'locked').length)
const omittedCount = computed(() => cells.value.filter((c) => c.kind === 'piece' && (c.excluded || skipPending.value && pending(c))).length)
// 有待核对项时按"跳过"计算可导入结果，这样导入按钮始终可用，跳过数量在按钮与确认面板里写明
const effectiveSkip = computed(() => skipPending.value || pendingCount.value > 0)
const review = computed(() => reviewRecognition(cells.value, elders.configMap, { skipPending: effectiveSkip.value }))
const importCount = computed(() => review.value.data?.previousLayout.length ?? 0)
const relatedElders = computed(() => elders.views.filter((v) => cells.value.some((c) => c.kind === 'piece' && !c.excluded && !(skipPending.value && pending(c)) && c.equipId === v.redEquip.id)))
/** 账号配置与截图冲突（未拥有 / 觉醒超限 / 携带数量 / 长老种类）；用来切换按钮、展开长老区并列出原因 */
const elderWarnings = computed(() => {
  const byEquip = new Map<number, number[]>()
  for (const c of cells.value) {
    if (c.kind !== 'piece' || c.excluded || !c.equipId) continue
    if (effectiveSkip.value && pending(c)) continue
    const eq = GAME.equipById[c.equipId]
    if (eq.elderId === undefined) continue
    byEquip.set(c.equipId, [...(byEquip.get(c.equipId) ?? []), c.awaken ?? 0])
  }
  const items = [...byEquip].map(([equipId, awakens]) => ({ equipId, awakens }))
  return checkRedEquips(items, elders.configMap, GAME)
})
const labelOf = (id: number) => {
  const e = GAME.equipById[id]
  const elder = e.elderId !== undefined ? GAME.elderById[e.elderId]?.name : null
  return `${ELEMENT_NAME[e.element]} · ${e.name} · ${GAME.shapeById[e.shapeId].cellCount}格 · ${TIER_NAME[e.tier]}${elder ? ` · ${elder}` : ''}`
}
const cellLabel = (c: RecognitionCell) => c.equipId ? labelOf(c.equipId) : ({ empty: '空格', locked: '未开放', unknown: '待识别', covered: '占用格', piece: '请选择法宝' })[c.kind]

function cancel() {
  revision++
  controller?.abort()
  controller = null
  busy.value = false
  status.value = '已取消，当前背包未改动'
}
async function load(file?: File) {
  if (!file) return
  cancel()
  const token = revision
  busy.value = true; error.value = ''; cells.value = []; grid.value = null; image.value = null
  imported.value = false; framing.value = false; corner.value = null
  try {
    const decoded = await decodeScreenshot(file)
    if (token !== revision) return
    image.value = decoded; filename.value = file.name
    await nextTick()
    if (token !== revision) return
    draw()
    await recognize()
  } catch (e) {
    if (token === revision) error.value = e instanceof Error ? e.message : '无法读取图片，请换一张截图'
  } finally {
    if (token === revision) busy.value = false
  }
}
/** 记住当前这一格：把用户确认的样子存下来，之后同类截图直接采信 */
function remember() {
  const img = image.value, g = grid.value, cell = active.value
  if (!img || !g || !cell || cell.kind !== 'piece' || !cell.equipId) {
    learnNote.value = '请先选中一件已确认的法宝'
    return
  }
  const sample = extractSample(fromRgba(img.width, img.height, img.data), g, cell.row, cell.col, cell.equipId)
  if (!sample) {
    learnNote.value = '这一格取不到足够的图案，请重新识别后再试'
    return
  }
  const merged = mergeSample(samples.value, sample)
  if (!merged.added) {
    learnNote.value = '已经记住过这个样子了'
    return
  }
  samples.value = merged.samples
  appStore().save('ocrSamples', { samples: merged.samples })
  // 用户亲手确认过，这一格不再算待核对
  cell.confirmed = true
  cell.manuallyConfirmed = true
  cell.reason = '已按你的选择记住'
  learnNote.value = sampleDrift(sample) > 45
    ? '已记住（这一格与内置图案差异较大，之后以你教的样子为准）'
    : '已记住，之后同类截图会直接匹配'
}

function clearSamples() {
  appStore().remove('ocrSamples')
  samples.value = []
  learnNote.value = '已清除全部学习记录'
}

async function recognize(manual = false) {
  if (!image.value) return
  controller?.abort()
  const run = new AbortController()
  controller = run
  const token = ++revision
  busy.value = true; error.value = ''; cells.value = []; imported.value = false
  framing.value = false; corner.value = null
  try {
    const output = await runRecognition(image.value, manual && grid.value ? { ...grid.value } : undefined, run.signal, (s) => { status.value = s }, samples.value)
    if (token !== revision) return
    grid.value = output.grid
    if (!output.result) { mobileView.value = 'original'; error.value = '未能可靠定位背包，请在截图上手动框选后识别'; return }
    cells.value = output.result.cells
    overlapCell.value = null
    mobileView.value = 'recognized'
    skipPending.value = false; quickSkipPrompt.value = false
    const hasPending = cells.value.some(pending)
    listMode.value = hasPending ? 'pending' : 'ready'
    reviewOpen.value = hasPending
    activeIndex.value = Math.max(0, cells.value.findIndex(pending))
    status.value = hasPending ? '识别完成，请核对标记项与红装觉醒' : '识别完成，可直接一键导入'
  } catch (e) {
    if (token === revision && !run.signal.aborted) error.value = e instanceof Error ? e.message : '识别失败'
  } finally {
    if (token === revision) { busy.value = false; draw() }
  }
}
function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  void load(input.files?.[0]); input.value = ''
}
function paste(event: ClipboardEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, [contenteditable]')) return
  const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
  if (file) { event.preventDefault(); void load(file) }
}
function pick(index: number) {
  if (busy.value || framing.value || !cells.value[index]) return
  activeIndex.value = index
  reviewOpen.value = true
}
function chooseCell(index: number) {
  if (busy.value || framing.value || !cells.value[index]) return
  const targets = reviewTargets(footprints.value, index)
  overlapCell.value = targets.length > 1 ? index : null
  if (targets.length === 1) pick(targets[0])
  else if (!targets.includes(activeIndex.value)) pick(targets[0] ?? index)
}
function confirmCurrent() {
  if (!canConfirm.value || busy.value || framing.value) return
  active.value.confirmed = true
  active.value.manuallyConfirmed = true
}
function confirmNext() {
  confirmCurrent()
  if (canConfirm.value) nextPending()
}
function nextPending() {
  const index = cells.value.findIndex((c, i) => i > activeIndex.value && pending(c))
  const next = index >= 0 ? index : cells.value.findIndex(pending)
  overlapCell.value = null
  if (next >= 0) pick(next)
  else status.value = '所有项目已核对，可检查整盘后导入'
}
/** 一键确认：剩余待核对的格子直接采用识别首选；无法自动处理的冲突格保持待核对 */
function confirmAllPending() {
  if (busy.value || framing.value) return
  for (const cell of cells.value) {
    if (!pending(cell) || cell.conflicts?.length) continue
    if (cell.kind === 'unknown') {
      const top = cell.candidates[0]
      if (!top) continue
      const eq = GAME.equipById[top.equipId]
      cell.kind = 'piece'; cell.equipId = eq.id
      cell.awaken = eq.elderId === undefined ? 0 : cell.awaken ?? 0
      cell.awakenDetected = false
    } else if (cell.kind === 'piece' && cell.awaken === null) {
      cell.awaken = 0
    }
    cell.confirmed = true
    cell.manuallyConfirmed = true
    cell.excluded = false
    cell.reason = '已采用识别首选'
  }
  rebuildCoverage(cells.value)
  quickSkipPrompt.value = false
  status.value = pendingCount.value ? `仍有 ${pendingCount.value} 项占格冲突需手动处理` : '已全部采用识别首选，可直接导入'
}
/** 长老配置与截图冲突时，滚动到长老块并展开，引导用户核对 */
function goReviewElders() {
  const el = elderBox.value
  if (!el) return
  el.open = true
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
/** 一键导入：长老冲突时按钮不可用（需人工确认）；仍有待核对时先确认跳过，否则直接导入 */
function quickImport() {
  if (!review.value.data || busy.value || framing.value) return
  if (pendingCount.value > 0 && !quickSkipPrompt.value) { quickSkipPrompt.value = true; return }
  importBag()
}
function toggleExcluded() {
  setExcluded(cells.value, activeIndex.value, !active.value?.excluded)
  // 已排除的法宝在「全部」里仍可见（灰色虚线），不再单独分组
  listMode.value = active.value?.excluded ? 'all' : pending(active.value) ? 'pending' : 'ready'
}
function clickPreview(event: MouseEvent) {
  if (!canvas.value || !image.value || busy.value) return
  const bounds = canvas.value.getBoundingClientRect()
  const area = previewBounds.value
  const x = area.x + (event.clientX - bounds.left) * area.w / bounds.width
  const y = area.y + (event.clientY - bounds.top) * area.h / bounds.height
  if (framing.value) {
    if (!corner.value) { corner.value = { x, y }; draw(); return }
    const first = corner.value
    const next = { ox: Math.min(first.x, x), oy: Math.min(first.y, y), pw: Math.abs(x - first.x) / 7, ph: Math.abs(y - first.y) / 6 }
    if (!validGrid({ w: image.value.width, h: image.value.height }, next)) { error.value = '框选区域过小或越界，请重新选择两个角'; corner.value = null; return }
    grid.value = next; corner.value = null; framing.value = false
    void recognize(true)
  } else if (grid.value && cells.value.length) {
    const r = Math.floor((y - grid.value.oy) / grid.value.ph), c = Math.floor((x - grid.value.ox) / grid.value.pw)
    if (r >= 0 && r < 6 && c >= 0 && c < 7) chooseCell(r * 7 + c)
  }
}
function changeCell(value: string) {
  const cell = active.value
  if (!cell) return
  if (['empty', 'locked', 'unknown'].includes(value)) {
    cell.kind = value as RecognitionCell['kind']; cell.equipId = null; cell.awaken = null; cell.confirmed = value !== 'unknown'
    if (value !== 'unknown') cell.anchorEvidence = false
  } else {
    const eq = GAME.equipById[+value]
    if (!eq) return
    const samePiece = cell.equipId === eq.id
    cell.kind = 'piece'; cell.equipId = eq.id; cell.awaken = eq.elderId === undefined ? 0 : samePiece ? cell.awaken ?? 0 : 0; cell.confirmed = true
    if (!samePiece) cell.awakenDetected = false
  }
  cell.excluded = false
  cell.manuallyConfirmed = cell.kind !== 'unknown'
  cell.reason = '手动校正'
  rebuildCoverage(cells.value)
  if (cells.value[activeIndex.value]?.kind === 'covered') chooseCell(activeIndex.value)
}
function draw() {
  if (!canvas.value || !image.value) return
  const ctx = canvas.value.getContext('2d')
  if (!ctx) return
  const area = previewBounds.value
  canvas.value.width = area.w; canvas.value.height = area.h
  ctx.putImageData(image.value, -area.x, -area.y)
  ctx.translate(-area.x, -area.y)
  if (grid.value) {
    const g = grid.value
    ctx.lineWidth = Math.max(1, g.pw / 90)
    for (let i = 0; i < 42; i++) {
      const row = Math.floor(i / 7), col = i % 7, cell = cells.value[i]
      const x = g.ox + col * g.pw, y = g.oy + row * g.ph
      ctx.strokeStyle = '#f5d67b99'; ctx.strokeRect(x, y, g.pw, g.ph)
      if (cell && cell.kind !== 'covered') {
        const color = cell.excluded ? '#ff8a80' : pending(cell) ? '#ffb74d' : cell.kind === 'locked' ? '#b5bccb' : '#78e3ba'
        ctx.fillStyle = '#111b'; ctx.fillRect(x + 2, y + 2, g.pw * 0.33, g.ph * 0.24)
        ctx.fillStyle = color; ctx.font = `bold ${g.ph * 0.16}px sans-serif`
        ctx.fillText(`${row + 1},${col + 1}`, x + 4, y + g.ph * 0.18)
      }
    }
    if (active.value) {
      const c = active.value
      const indices = c.equipId ? occupiedCells(c.equipId, c.row, c.col) ?? [activeIndex.value] : [activeIndex.value]
      ctx.lineWidth = g.pw / 25; ctx.strokeStyle = '#fff'
      ctx.beginPath()
      for (const i of indices) {
        const x = g.ox + i % 7 * g.pw, y = g.oy + Math.floor(i / 7) * g.ph
        if (i < 7 || !indices.includes(i - 7)) { ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + g.pw - 2, y + 2) }
        if (i >= 35 || !indices.includes(i + 7)) { ctx.moveTo(x + 2, y + g.ph - 2); ctx.lineTo(x + g.pw - 2, y + g.ph - 2) }
        if (i % 7 === 0 || !indices.includes(i - 1)) { ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + 2, y + g.ph - 2) }
        if (i % 7 === 6 || !indices.includes(i + 1)) { ctx.moveTo(x + g.pw - 2, y + 2); ctx.lineTo(x + g.pw - 2, y + g.ph - 2) }
      }
      ctx.stroke()
      if (thumb.value) {
        const t = thumb.value.getContext('2d')
        if (t) {
          const left = Math.min(...indices.map((i) => i % 7)), top = Math.min(...indices.map((i) => Math.floor(i / 7)))
          const w = Math.max(...indices.map((i) => i % 7)) - left + 1, h = Math.max(...indices.map((i) => Math.floor(i / 7))) - top + 1
          thumb.value.width = w * 100; thumb.value.height = h * 100
          const raw = document.createElement('canvas'); raw.width = image.value.width; raw.height = image.value.height
          raw.getContext('2d')?.putImageData(image.value, 0, 0)
          t.drawImage(raw, g.ox + left * g.pw, g.oy + top * g.ph, w * g.pw, h * g.ph, 0, 0, w * 100, h * 100)
        }
      }
    }
  }
  if (corner.value) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath()
    ctx.arc(corner.value.x, corner.value.y, 10, 0, Math.PI * 2); ctx.stroke()
  }
}
function importBag() {
  if (busy.value || framing.value) return
  const result = bag.importRecognition(cells.value, effectiveSkip.value)
  if (!result.ok) { error.value = result.reason; return }
  solver.setBoardMode('current')
  imported.value = true; error.value = ''; quickSkipPrompt.value = false
  // 导入成功直接进入优化器（测试环境无路由时留在原页并显示成功提示）
  void router?.push('/solver')
}
watch([cells, grid], async () => { imported.value = false; quickSkipPrompt.value = false; await nextTick(); draw() }, { deep: true })
watch(activeIndex, async () => { await nextTick(); draw() })
watch([framing, showFull, mobileView], async () => { if (framing.value) mobileView.value = 'original'; await nextTick(); draw() })
watch(() => cells.value.length, () => { overlapCell.value = null })
onMounted(() => window.addEventListener('paste', paste))
onBeforeUnmount(() => { cancel(); window.removeEventListener('paste', paste) })
</script>

<template>
  <div class="recognize-page">
    <section class="panel intro" @dragover.prevent @drop.prevent="load($event.dataTransfer?.files[0])">
      <div>
        <h2>截图识别 <span class="badge">本地处理 · 测试版</span></h2>
        <p class="muted">游历中、游历完成的背包截图均可。先识别，再核对，最后导入；图片不会上传。</p>
      </div>
      <label class="upload">{{ image ? '更换截图' : '选择截图' }}<input type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择截图" @change="onFile" /></label>
      <span class="muted small">也可拖入或粘贴图片 · PNG / JPG / WebP · ≤20 MB</span>
    </section>
    <p v-if="busy" class="panel row" role="status">{{ status }} <button @click="cancel">取消识别</button></p>
    <p v-if="error" class="panel danger" role="alert">{{ error }}</p>
    <div v-if="image" class="workspace" :data-mobile-view="mobileView">
      <div class="mobile-switch row" aria-label="对照视图">
        <button :aria-pressed="mobileView === 'original'" @click="mobileView = 'original'">原图</button>
        <button :aria-pressed="mobileView === 'recognized'" :disabled="framing || !cells.length" @click="mobileView = 'recognized'">识别背包</button>
      </div>
      <section class="panel preview">
        <div class="row"><h3>原始背包</h3><span class="muted small">{{ filename }}</span></div>
        <div class="row">
          <button :disabled="busy" @click="recognize()">自动重新识别</button>
          <button :disabled="framing" @click="showFull = !showFull">{{ showFull ? '只看背包' : '完整截图' }}</button>
          <button :disabled="busy" @click="framing = !framing; corner = null">{{ framing ? '取消框选' : '手动框选网格' }}</button>
        </div>
        <p class="small" :class="framing ? 'warn' : 'muted'">{{ framing ? (corner ? '再点背包网格右下角（不含外框）' : '先点背包网格左上角（不含外框）') : '应仅框住 6 行 × 7 列背包，不含上方待放置法宝。点击格子可校正。' }}</p>
        <details v-if="grid">
          <summary>精调网格坐标</summary>
          <fieldset :disabled="busy" class="grid-fields">
            <label v-for="(name, key) in { ox: '左边', oy: '上边', pw: '格宽', ph: '格高' }" :key="key">{{ name }}<input v-model.number="grid[key]" type="number" min="0" step="0.5" @change="cells = []" /></label>
            <button @click="recognize(true)">按此网格识别</button>
          </fieldset>
        </details>
        <div class="canvas-scroll"><canvas ref="canvas" aria-label="截图网格预览" @click="clickPreview" /></div>
      </section>
      <section class="panel review">
        <h3>识别背包 <span class="muted small">· 点击法宝核对</span></h3>
        <p v-if="!cells.length" class="muted">识别结果会显示在这里。网格定位不准时，可以在原图中手动框选。</p>
        <template v-else>
          <div class="quick-actions">
            <button v-if="pendingCount" class="small" :disabled="busy || framing" @click="confirmAllPending">一键确认 {{ pendingCount }} 项（采用识别首选）</button>
            <button v-if="elderWarnings.length" class="primary quick-import" :disabled="busy || framing" @click="goReviewElders">
              核对长老信息（{{ elderWarnings.length }} 项需处理）
            </button>
            <button v-else class="primary quick-import" :disabled="!review.data || busy || framing" @click="quickImport">
              {{ pendingCount ? `一键导入（跳过 ${pendingCount} 项待核对，共 ${importCount} 件）` : `一键导入（${importCount} 件）` }}
            </button>
          </div>
          <div v-if="quickSkipPrompt" class="quick-confirm row">
            <span class="warn small">将跳过 {{ pendingCount }} 项待核对 / 未识别格，仅导入 {{ importCount }} 件。</span>
            <button class="primary small" :disabled="!review.data" @click="importBag">确认导入</button>
            <button class="ghost small" @click="quickSkipPrompt = false">取消</button>
          </div>
          <div class="row review-tabs" aria-label="核对分组">
            <button v-for="(label, mode) in { all: '全部', pending: '待核对', conflict: '冲突', ready: '无需核对' }" :key="mode" :class="['chip', { on: listMode === mode }]" :aria-pressed="listMode === mode" @click="listMode = mode">{{ label }} {{ groups[mode].length }}</button>
            <span class="chip locked-chip" aria-label="锁格数量">锁格 {{ lockedCount }}</span>
          </div>
          <p class="muted small">筛选只淡化其它法宝，不隐藏位置。点击斜纹格可选择重叠法宝。</p>
          <ReviewBoard :cells="cells" :active-index="activeIndex" :filter="listMode" :skip-pending="skipPending" :disabled="busy || framing" @cell-click="chooseCell" />
          <div class="board-legend small"><span>品阶底色：高置信度</span><span class="warn">? 待核对</span><span class="danger">斜纹 ! 冲突</span><span class="ok">核 已人工核对</span><span class="muted">灰色虚线 删 不导入</span><span>白框：当前选中</span></div>
        </template>
      </section>
      <section v-if="cells.length" class="panel review-editor">
          <button type="button" class="row manual-toggle" :aria-expanded="reviewOpen" @click="reviewOpen = !reviewOpen">
            <span class="chevron" aria-hidden="true">{{ reviewOpen ? '▾' : '▸' }}</span>
            <b>核对与手动编辑</b>
            <span v-if="pendingCount" class="warn small">{{ pendingCount }} 项待核对</span>
            <span v-else class="ok small">全部无需核对</span>
          </button>
          <div v-show="reviewOpen" class="manual-review">
          <div v-if="overlapChoices.length > 1" class="overlap-choices" role="group" aria-label="重叠格涉及的法宝">
            <p class="warn small">此格涉及多个对象，请选择要核对的一件：</p>
            <div class="row"><button v-for="i in overlapChoices" :key="i" class="small" :class="{ primary: activeIndex === i }" :aria-pressed="activeIndex === i" @click="pick(i)">{{ cells[i].row + 1 }},{{ cells[i].col + 1 }} {{ cellLabel(cells[i]) }}</button><button class="small ghost" @click="overlapCell = null">关闭选择条</button></div>
          </div>
          <div class="row editor-heading"><h3>核对当前法宝</h3><button class="small" :disabled="!pendingCount || busy || framing" @click="nextPending">下一个待核对</button><button class="small ghost" @click="editor?.scrollIntoView({ block: 'center', behavior: 'smooth' })">定位编辑区</button></div>
          <details class="text-review"><summary>辅助文字列表 · {{ entries.length }} 项</summary>
            <p v-if="!entries.length" class="ok small">此分组暂无项目。</p>
            <div class="cell-list">
              <button v-for="c in entries" :key="c.row * 7 + c.col" :class="{ active: activeIndex === c.row * 7 + c.col, pending: pending(c) }" :disabled="busy || framing" @click="pick(c.row * 7 + c.col)">
                <span class="coord">{{ c.row + 1 }},{{ c.col + 1 }}</span><span>{{ cellLabel(c) }}</span><span v-if="pending(c)" class="small">{{ c.conflicts?.length ? '占格冲突' : '待核对' }}</span>
              </button>
            </div>
          </details>
          <fieldset v-if="active" ref="editor" class="editor" :disabled="busy || framing">
            <legend>第 {{ active.row + 1 }} 行 · 第 {{ active.col + 1 }} 列</legend>
            <div class="row current-label"><b>{{ cellLabel(active) }}</b><span class="small" :class="pending(active) ? 'warn' : 'ok'">{{ REVIEW_STATUS_NAME[reviewStatus(active, skipPending)] }}</span></div>
            <div class="editor-content">
              <canvas ref="thumb" aria-label="当前法宝截图" class="thumb" />
              <div class="editor-controls">
                <div v-if="active.candidates.length" class="row candidates"><span class="muted small">相近候选：</span><button v-for="c in active.candidates.slice(0, 3)" :key="c.equipId" class="small" @click="changeCell(String(c.equipId))">{{ labelOf(c.equipId) }}</button></div>
                <details :key="activeIndex" class="equip-filter" :open="active.kind === 'unknown'"><summary>修改法宝 / 更多候选</summary><ReviewEquipPicker :model-value="active.equipId" :suggested-id="active.candidates[0]?.equipId" @update:model-value="changeCell(String($event))" /></details>
                <div class="row cell-actions"><button class="small" @click="changeCell('empty')">设为空格</button><button class="small" @click="changeCell('locked')">设为未开放</button></div>
                <label v-if="activeEquip?.elderId !== undefined">此份红装觉醒 <span v-if="active.awakenDetected" class="ok small">已自动识别，可修改</span><select v-model="active.awaken" aria-label="此份红装觉醒" @change="active.awakenDetected = false">
                  <option :value="null">请选择（待确认）</option><option v-for="n in maxAwaken + 1" :key="n" :value="n - 1">{{ n === 1 ? '未觉醒（0）' : `觉醒 ${n - 1}` }}</option>
                </select></label>
                <label v-if="active.kind !== 'unknown' && !active.excluded" class="row"><input :checked="active.manuallyConfirmed ?? false" type="checkbox" @change="active.manuallyConfirmed = ($event.target as HTMLInputElement).checked; active.confirmed = active.manuallyConfirmed" />已核对此项</label>
                <button v-if="active.kind === 'piece'" class="small" :class="active.excluded ? 'ok' : 'danger'" @click="toggleExcluded">{{ active.excluded ? '恢复此法宝' : '删除此法宝' }}</button>
                <p v-if="active.excluded" class="muted small">此份法宝已删除，不会导入。可随时恢复。</p>
                <button v-if="active.kind === 'piece' && !active.excluded" class="small" @click="remember">记住这个样子</button>
                <p v-if="learnNote" class="small ok">{{ learnNote }}</p>
                <div class="row learn-bar">
                  <span class="muted small">已记住 {{ samples.length }} 条 · {{ learnedEquips }} 件法宝</span>
                  <button class="small ghost" :disabled="!samples.length" @click="clearSamples">清除学习记录</button>
                </div>
              </div>
            </div>
            <ul v-if="active.conflicts?.length" class="warn small conflict-list"><li v-for="message in active.conflicts" :key="message">{{ message }}</li></ul>
            <p class="muted small">{{ active.reason || '核对图案、品阶、形状及角标后再导入。' }}</p>
            <div class="row confirm-actions"><button class="primary" :disabled="!canConfirm" @click="confirmNext">确认并下一个</button><span v-if="active.conflicts?.length" class="warn small">请先修正重叠形状或删除误识别法宝。</span><span v-else-if="!pendingCount" class="ok small" role="status">全部已核对</span></div>
          </fieldset>
          </div>
          <details v-if="relatedElders.length" ref="elderBox" class="account-settings" :open="elderWarnings.length > 0">
            <summary>调整关联长老<span v-if="elderWarnings.length" class="warn small"> · {{ elderWarnings.length }} 项需处理</span><span v-else class="muted small">（{{ relatedElders.length }} 位）</span></summary>
            <ul v-if="elderWarnings.length" class="warn small elder-alerts"><li v-for="(msg, i) in elderWarnings" :key="i">{{ msg }}</li></ul>
            <p class="muted small">账号配置与截图冲突时，请按实际账号调整。识图不会自动提高星级或觉醒，也不会把副本觉醒改成账号上限。</p>
            <ElderCard v-for="v in relatedElders" :key="v.elder.id" :view="v" />
          </details>
          <details class="import-box" :open="!review.data && review.errors.length > 0">
            <summary>更多导入选项{{ review.data ? '' : ' · 有待处理项' }}</summary>
            <label class="row"><input v-model="skipPending" type="checkbox" aria-label="不导入待核对项" :disabled="busy || framing" />不导入待核对的法宝 / 未识别格</label>
            <p class="small muted">{{ review.data ? `本次导入 ${importCount} 件法宝` : '请处理下方提示后导入' }}；排除 {{ omittedCount }} 件。被排除的法宝位置留空，已确认的未开放格保留。导入即替换当前背包、未开放格与「之前摆盘」，成功后自动进入优化器。</p>
            <div v-if="review.errors.length" class="warn small"><p>还有 {{ review.errors.length }} 项需要处理：</p><ul><li v-for="e in review.errors.slice(0, 6)" :key="e">{{ e }}</li></ul><span v-if="review.errors.length > 6">其余项请查看上方列表。</span></div>
            <button
              class="primary" :disabled="!review.data || busy || framing" @click="importBag"
            >{{ pendingCount ? `跳过 ${pendingCount} 项待核对并导入（${importCount} 件）` : `导入并替换背包（${importCount} 件）` }}</button>
            <p v-if="imported" class="ok" role="status">导入完成。<RouterLink to="/solver">前往优化器</RouterLink>，可在「之前摆盘」查看截图中的摆法。</p>
          </details>
          <div v-if="cells.length" class="import-bar">
            <span class="muted small">待核对 {{ pendingCount }} · 将导入 {{ importCount }} 件</span>
            <button
              class="primary small" :disabled="!review.data || busy || framing" @click="importBag"
            >{{ pendingCount ? '跳过并导入' : '导入' }}</button>
          </div>
      </section>
    </div>
    <section v-else-if="!busy" class="panel empty-state"><h3>从一张截图开始</h3><p class="muted">保持背包完整、无遮挡，尽量使用原始截图。仅识别背包中的法宝与未开放格，不识别弟子天赋和长老星级。</p><ol><li>选择或粘贴截图</li><li>核对网格、法宝和每份红装觉醒</li><li>确认替换背包，保留原始摆法</li></ol></section>
  </div>
</template>

<style scoped>
.recognize-page { display: grid; gap: 12px; }
h2, h3, p { margin: 0 0 10px; }
h2 { font-size: 20px; } h3 { font-size: 15px; }
.intro { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 20px; padding: 20px; }
.intro > div { flex: 1; min-width: 220px; }.intro p { margin: 0; }
.badge { display: inline-block; font-size: 11px; color: var(--gold); border: 1px solid var(--line); padding: 3px 8px; border-radius: 20px; vertical-align: middle; }
.upload { position: relative; overflow: hidden; background: var(--gold); color: #1b1f29; border-radius: 8px; padding: 10px 24px; font-weight: 600; cursor: pointer; }.upload input { position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer; }
.upload:focus-within { outline: 2px solid white; outline-offset: 3px; }
.workspace { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
.preview, .review { min-width: 0; }.preview .row { margin-bottom: 8px; }.preview .row span { overflow-wrap: anywhere; }
.mobile-switch { display: none; }.review-editor { grid-column: 1 / -1; min-width: 0; }
.canvas-scroll { max-height: 78vh; overflow: auto; margin-top: 10px; padding: 6px; border: 1px solid var(--line); background: var(--outline); border-radius: 14px; }canvas { display: block; max-width: 100%; height: auto; }.canvas-scroll canvas { width: 100%; cursor: crosshair; }
.board-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 12px; color: var(--text-dim); }
.overlap-choices { padding: 12px; border: 1px solid var(--warn); border-radius: 8px; margin-bottom: 12px; }.overlap-choices button { text-align: left; }
.current-label { margin-bottom: 12px; }.current-label b { font-size: 15px; }.editor-heading { justify-content: space-between; }.editor-heading h3 { margin-right: auto; }
.text-review { margin-bottom: 12px; }.equip-filter { margin-bottom: 10px; }.confirm-actions { margin-top: 12px; }
.stats { display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }.stats span { background: var(--bg); padding: 8px 12px; border-radius: 8px; }.stats b { color: var(--gold); font-size: 21px; margin-right: 5px; }
.cell-list { display: grid; gap: 4px; max-height: 240px; overflow-y: auto; margin-bottom: 12px; }.cell-list button { display: flex; align-items: center; gap: 8px; text-align: left; font-size: 12px; padding: 7px 8px; }.cell-list button span:nth-child(2) { flex: 1; }.cell-list .active { border-color: var(--gold); background: var(--gold-weak); }.pending .coord { color: var(--warn); }.pending > .small { color: var(--warn); }.coord { font-variant-numeric: tabular-nums; color: var(--ok); }
fieldset { border: 1px solid var(--line); border-radius: 8px; margin: 0 0 12px; padding: 12px; min-width: 0; }legend { color: var(--gold); }.editor-content { display: flex; align-items: flex-start; gap: 12px; }.thumb { width: 110px; max-height: 250px; object-fit: contain; flex-shrink: 0; }.editor-controls { flex: 1; min-width: 0; }.editor-controls > label { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; font-size: 12px; }.editor-controls > label.row { flex-direction: row; }.editor-controls input, .editor-controls select { width: 100%; min-width: 0; }.editor-controls input[type=checkbox] { width: auto; }.candidates { gap: 5px; }.candidates button { text-align: left; }
summary { cursor: pointer; color: var(--gold); padding: 8px 0; }.grid-fields { display: flex; flex-wrap: wrap; gap: 8px; }.grid-fields label { width: 80px; font-size: 12px; }.grid-fields input { width: 100%; }.account-settings { margin: 12px 0; }.account-settings :deep(.elder-card) { margin-bottom: 8px; }.import-box { border-top: 1px solid var(--line); padding-top: 14px; }.import-box > label { margin: 12px 0; font-size: 12px; }.import-box p:last-child { margin-top: 10px; }.import-box a { color: var(--gold); }.import-box ul { padding-left: 20px; margin: 0 0 8px; }
.quick-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 2px 0 10px; }
.quick-actions .quick-import { font-weight: 600; }
.quick-confirm { gap: 8px; align-items: center; margin: 0 0 10px; padding: 8px 10px; border: 1px solid var(--warn); border-radius: 8px; background: var(--bg); flex-wrap: wrap; }
.quick-confirm span { flex: 1; min-width: 160px; }
.manual-toggle { display: flex; align-items: center; gap: 8px; width: 100%; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; cursor: pointer; }
.manual-toggle .chevron { color: var(--gold); }
.manual-review { display: block; }
.review-tabs { margin: 10px 0; gap: 6px; flex-wrap: wrap; }
.locked-chip { margin-left: auto; color: var(--text-dim); cursor: default; border-style: dashed; }
.cell-actions { margin: 10px 0; }
.learn-bar { gap: 8px; margin-top: 6px; }
.elder-alerts { margin: 6px 0 0; padding-left: 18px; }
.import-bar { display: none; }
@media (max-width: 900px) {
  .import-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    position: sticky;
    bottom: 0;
    z-index: 6;
    background: var(--bg-panel);
    border-top: 1px solid var(--line);
    padding: 8px 0 calc(8px + env(safe-area-inset-bottom));
  }
  .import-bar span { flex: 1; }
}
.empty-state { padding: 30px; }.empty-state ol { display: flex; flex-wrap: wrap; gap: 20px 45px; padding-left: 20px; color: var(--gold); }
@media (min-width: 801px) { .editor-content { gap: 20px; }.thumb { width: 150px; }.editor-controls { max-width: 640px; } }
@media (max-width: 800px) {
  .workspace { grid-template-columns: 1fr; }.mobile-switch { display: flex; position: sticky; top: 0; z-index: 5; padding: 8px; background: var(--bg-panel); border-radius: 8px; }
  .mobile-switch button { flex: 1; }.mobile-switch button[aria-pressed=true] { border-color: var(--gold); color: var(--gold); }
  .workspace[data-mobile-view=recognized] .preview, .workspace[data-mobile-view=original] .review { display: none; }
  .canvas-scroll { max-height: 70vh; }.thumb { width: 85px; }.intro { padding: 14px; }.empty-state ol { display: block; }.empty-state li { margin: 10px 0; }
  .editor-heading { gap: 6px; }.editor-heading h3 { width: 100%; }.stats { gap: 6px; }.stats span { padding: 6px 8px; }
}
</style>
