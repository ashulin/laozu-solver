// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import RecognizeView from '@/views/RecognizeView.vue'
import ReviewEquipPicker from '@/components/recognize/ReviewEquipPicker.vue'
import { useSolverStore } from '@/stores/solver'
import { GAME } from '@/core/data'
import { decodeScreenshot, runRecognition } from '@/services/recognition'
import { appStore, memoryStorage, setStorageBackend } from '@/services/app-storage'
import { useBagStore } from '@/stores/bag'
import { enableAutoPersist } from '@/stores/persist'
import type { RecognitionCell } from '@/core/ocr/recognize'
import { rebuildCoverage } from '@/core/ocr/draft'

vi.mock('@/services/recognition', () => ({ decodeScreenshot: vi.fn(), runRecognition: vi.fn() }))
const draft = (): RecognitionCell[] => Array.from({ length: 42 }, (_, i) => ({
  row: Math.floor(i / 7), col: i % 7, kind: i === 0 ? 'piece' : 'empty', equipId: i === 0 ? 110101 : null,
  awaken: i === 0 ? 0 : null, confirmed: true, reason: '', candidates: [],
}))
const grid = { ox: 0, oy: 0, pw: 100, ph: 100 }
const image = { width: 700, height: 600, data: new Uint8ClampedArray(700 * 600 * 4) } as ImageData
const wrappers: ReturnType<typeof mount>[] = []
const create = () => { const w = mount(RecognizeView, { global: { stubs: { RouterLink: true } } }); wrappers.push(w); return w }
const upload = async (w: ReturnType<typeof mount>) => {
  const input = w.find('input[type=file]')
  Object.defineProperty(input.element, 'files', { value: [new File(['image'], 'bag.png', { type: 'image/png' })], configurable: true })
  await input.trigger('change'); await flushPromises()
}
beforeEach(() => {
  vi.resetAllMocks()
  setStorageBackend(memoryStorage()); setActivePinia(createPinia())
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.mocked(decodeScreenshot).mockResolvedValue(image)
  vi.mocked(runRecognition).mockResolvedValue({ type: 'done', grid, result: { grid, cells: draft() } })
})
afterEach(() => { wrappers.splice(0).forEach((w) => w.unmount()); vi.restoreAllMocks() })

describe('截图识别页', () => {
  it('识别不修改背包；勾选确认后原子导入并持久化', async () => {
    const stop = enableAutoPersist()
    const bag = useBagStore(); bag.add(120101)
    const w = create()
    await upload(w)
    expect(bag.selected[0].equipId).toBe(120101)
    const submit = w.find('.import-box button.primary')
    expect(submit.attributes('disabled')).toBeDefined()
    await w.find('.import-box input[aria-label="确认替换背包"]').setValue(true)
    await submit.trigger('click')
    expect(bag.selected).toEqual([{ equipId: 110101, copies: [{ awaken: 0 }] }])
    expect(bag.previousLayout).toEqual([{ equipId: 110101, awaken: 0, r: 0, c: 0 }])
    expect(w.text()).toContain('导入完成')
    expect(useSolverStore().boardMode).toBe('current')
    stop(); setActivePinia(createPinia())
    expect(useBagStore().previousLayout).toEqual([{ equipId: 110101, awaken: 0, r: 0, c: 0 }])
    expect(useSolverStore().boardMode).toBe('current')
  })
  it('低置信结果需核对，修改结果会撤销整盘确认', async () => {
    const cells = draft(); cells[0].confirmed = false
    vi.mocked(runRecognition).mockResolvedValue({ type: 'done', grid, result: { grid, cells } })
    const w = create(); await upload(w)
    const accept = w.find('input[aria-label="确认替换背包"]')
    expect(accept.attributes('disabled')).toBeDefined()
    await w.find('.editor input[type=checkbox]').setValue(true)
    await accept.setValue(true)
    await w.find('select[aria-label="核对品阶"]').setValue('2')
    await w.find('select[aria-label="具体法宝"]').setValue('120101')
    expect((accept.element as HTMLInputElement).checked).toBe(false)
    expect(useBagStore().selected).toEqual([])
  })
  it('解码失败提示错误且不改背包；再次选图可以恢复', async () => {
    vi.mocked(decodeScreenshot).mockRejectedValueOnce(new Error('图片格式不支持'))
    const w = create(); await upload(w)
    expect(w.find('[role=alert]').text()).toContain('图片格式不支持')
    expect(useBagStore().selected).toEqual([])
    await upload(w)
    expect(w.find('.cell-list').exists()).toBe(true)
    expect(w.find('[role=alert]').exists()).toBe(false)
  })
  it('换图时忽略旧任务结果；卸载时取消正在运行的任务', async () => {
    let resolveOld!: (value: Awaited<ReturnType<typeof runRecognition>>) => void
    vi.mocked(runRecognition).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    const w = create(); await upload(w)
    const oldSignal = vi.mocked(runRecognition).mock.calls[0][2]
    await upload(w)
    expect(oldSignal.aborted).toBe(true)
    resolveOld({ type: 'done', grid, result: null }); await flushPromises()
    expect(w.find('.cell-list').exists()).toBe(true)
    expect(w.find('[role=alert]').exists()).toBe(false)
    const latest = vi.mocked(runRecognition).mock.calls[1][2]
    w.unmount()
    expect(latest.aborted).toBe(true)
  })
  it('默认仅显示待核对项，可切换全部；跳过未核对后只导入其余原位置', async () => {
    const cells = draft()
    Object.assign(cells[2], { kind: 'piece', equipId: 120101, awaken: 0, confirmed: false })
    vi.mocked(runRecognition).mockResolvedValue({ type: 'done', grid, result: { grid, cells } })
    const w = create(); await upload(w)
    expect(w.findAll('.cell-list button')).toHaveLength(1)
    expect(w.text()).not.toContain('共鸣数字')
    await w.findAll('.review-tabs button').find((b) => b.text().startsWith('全部'))!.trigger('click')
    expect(w.findAll('.cell-list button')).toHaveLength(42)
    await w.find('input[aria-label="不导入待核对项"]').setValue(true)
    await w.find('input[aria-label="确认替换背包"]').setValue(true)
    await w.find('.import-box button.primary').trigger('click')
    expect(useBagStore().previousLayout).toEqual([{ equipId: 110101, awaken: 0, r: 0, c: 0 }])
    expect(useSolverStore().boardMode).toBe('current')
  })
  it('删除和恢复当前法宝，列表有独立已删除分组', async () => {
    const w = create(); await upload(w)
    await w.findAll('button').find((b) => b.text() === '删除此法宝')!.trigger('click')
    expect(w.find('.cell-list').text()).toContain('蕴金戒')
    expect(w.findAll('.review-tabs button').find((b) => b.text().startsWith('已排除'))!.attributes('aria-pressed')).toBe('true')
    expect(w.text()).toContain('本次导入 0 件法宝')
    await w.findAll('button').find((b) => b.text() === '恢复此法宝')!.trigger('click')
    expect(w.text()).toContain('本次导入 1 件法宝')
  })
  it('分级筛选默认随当前装备，不直接修改装备；清空后可搜索长老', async () => {
    const w = mount(ReviewEquipPicker, { props: { modelValue: 110101 } }); wrappers.push(w)
    expect((w.find('[aria-label="核对元素"]').element as HTMLSelectElement).value).toBe('1')
    expect((w.find('[aria-label="核对占格"]').element as HTMLSelectElement).value).toBe('1')
    expect(w.findAll('[aria-label="具体法宝"] option')).toHaveLength(2)
    await w.find('[aria-label="核对品阶"]').setValue('2')
    expect(w.emitted('update:modelValue')).toBeUndefined()
    await w.find('[aria-label="具体法宝"]').setValue('120101')
    expect(w.emitted('update:modelValue')).toEqual([[120101]])
    await w.findAll('button').find((b) => b.text() === '清空筛选')!.trigger('click')
    await w.find('input').setValue('孙悟空')
    const red = GAME.elders.find((e) => e.name === '孙悟空')!
    expect(w.find(`option[value="${red.redEquipId}"]`).text()).toContain('孙悟空')
    expect(w.find(`option[value="${red.redEquipId}"]`).text()).toContain('格')
  })
  it('交叉法宝都在待核对，勾选不能覆盖冲突，修正形状后双方自动恢复', async () => {
    const cells = draft()
    for (const [index, id] of [[25, 140108], [33, 110103], [34, 140103]]) Object.assign(cells[index], { kind: 'piece', equipId: id, awaken: 0, confirmed: true })
    rebuildCoverage(cells)
    vi.mocked(runRecognition).mockResolvedValue({ type: 'done', grid, result: { grid, cells } })
    const w = create(); await upload(w)
    expect(w.findAll('.cell-list button')).toHaveLength(3)
    expect(w.find('.conflict-list').text()).toContain('5,6')
    await w.find('.editor input[type=checkbox]').setValue(true)
    expect(w.findAll('.cell-list button')).toHaveLength(3)
    await w.findAll('.cell-list button').find((b) => b.text().startsWith('5,6'))!.trigger('click')
    await w.findAll('.review-picker button').find((b) => b.text() === '清空筛选')!.trigger('click')
    await w.find('[aria-label="具体法宝"]').setValue('110101')
    expect(w.findAll('.cell-list button')).toHaveLength(0)
    expect(w.find('.conflict-list').exists()).toBe(false)
    expect(w.find('input[aria-label="确认替换背包"]').attributes('disabled')).toBeUndefined()
  })
  it('觉醒默认0时无需额外确认，并可手动修改', async () => {
    const cells = draft()
    const id = GAME.equips.find((e) => e.name === '朔气飞星')!.id
    Object.assign(cells[0], { kind: 'piece', equipId: id, awaken: 0, awakenDetected: false, confirmed: true })
    rebuildCoverage(cells)
    vi.mocked(runRecognition).mockResolvedValue({ type: 'done', grid, result: { grid, cells } })
    const w = create(); await upload(w)
    expect((w.find('[aria-label="此份红装觉醒"]').element as HTMLSelectElement).value).toBe('0')
    expect(w.find('input[aria-label="确认替换背包"]').attributes('disabled')).toBeUndefined()
    expect(w.text()).not.toContain('已自动识别，可修改')
    await w.find('[aria-label="此份红装觉醒"]').setValue('2')
    expect((w.find('[aria-label="此份红装觉醒"]').element as HTMLSelectElement).value).toBe('2')
  })
  it('图形背包点击后编辑对应法宝，确认并下一个依次处理，不改当前背包', async () => {
    const cells = draft(); cells[0].confirmed = false
    Object.assign(cells[3], { kind: 'piece', equipId: 120101, awaken: 0, confirmed: false })
    vi.mocked(runRecognition).mockResolvedValue({ type: 'done', grid, result: { grid, cells } })
    const w = create(); await upload(w)
    expect(w.find('.text-review').attributes('open')).toBeUndefined()
    await w.find('[data-cell="0"]').trigger('click')
    await w.findAll('button').find((b) => b.text() === '确认并下一个')!.trigger('click')
    expect(Number(w.find('.review-cell[aria-current="true"]').attributes('data-cell'))).toBe(3)
    expect(w.find('[data-cell="0"]').text()).toContain('核')
    expect(w.find('.editor legend').text()).toContain('第 4 列')
    await w.findAll('button').find((b) => b.text() === '确认并下一个')!.trigger('click')
    expect(w.text()).toContain('全部已核对')
    expect(useBagStore().selected).toEqual([])
    await w.find('[data-cell="6"]').trigger('click')
    expect(w.find('.editor legend').text()).toContain('第 7 列')
  })
  it('点重叠格提供所有法宝选项，选择后突出整件且不可确认冲突', async () => {
    const cells = draft()
    for (const [index, id] of [[25, 140108], [33, 110103], [34, 140103]]) Object.assign(cells[index], { kind: 'piece', equipId: id, awaken: 0, confirmed: true })
    rebuildCoverage(cells)
    vi.mocked(runRecognition).mockResolvedValue({ type: 'done', grid, result: { grid, cells } })
    const w = create(); await upload(w)
    await w.find('[data-cell="40"]').trigger('click')
    expect(w.find('.overlap-choices').text()).toContain('5,6')
    expect(w.find('.overlap-choices').text()).toContain('5,7')
    await w.findAll('.overlap-choices button').find((b) => b.text().startsWith('5,7'))!.trigger('click')
    expect(Number(w.find('.review-cell[aria-current="true"]').attributes('data-cell'))).toBe(34)
    expect(w.find('[data-cell="41"]').attributes('aria-pressed')).toBe('true')
    expect(w.findAll('button').find((b) => b.text() === '确认并下一个')!.attributes('disabled')).toBeDefined()
    await w.findAll('.mobile-switch button').find((b) => b.text() === '原图')!.trigger('click')
    expect(w.find('.workspace').attributes('data-mobile-view')).toBe('original')
    const canvas = w.find('canvas[aria-label="截图网格预览"]')
    vi.spyOn(canvas.element, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 700, height: 600 } as DOMRect)
    await canvas.trigger('click', { clientX: 450, clientY: 550 })
    expect(w.find('.overlap-choices').text()).toContain('4,5')
    expect(w.find('.overlap-choices').text()).toContain('5,6')
    await w.findAll('.overlap-choices button').find((b) => b.text().startsWith('4,5'))!.trigger('click')
    expect(Number(w.find('.review-cell[aria-current="true"]').attributes('data-cell'))).toBe(25)
    await w.findAll('.mobile-switch button').find((b) => b.text() === '识别背包')!.trigger('click')
    expect(Number(w.find('.review-cell[aria-current="true"]').attributes('data-cell'))).toBe(25)
  })
  it('删除痕迹下可选释放格补录，覆盖的锚点改为空后重新选中所属法宝', async () => {
    const cells = draft()
    Object.assign(cells[0], { equipId: 140102 })
    rebuildCoverage(cells)
    vi.mocked(runRecognition).mockResolvedValue({ type: 'done', grid, result: { grid, cells } })
    const w = create(); await upload(w)
    await w.findAll('button').find((b) => b.text() === '删除此法宝')!.trigger('click')
    await w.find('[data-cell="1"]').trigger('click')
    expect(w.find('.overlap-choices').text()).toContain('1,2 空格')
    await w.findAll('.overlap-choices button').find((b) => b.text().startsWith('1,2'))!.trigger('click')
    expect(Number(w.find('.review-cell[aria-current="true"]').attributes('data-cell'))).toBe(1)
    await w.find('[aria-label="具体法宝"]').setValue('140101')
    expect(w.find('.current-label').text()).toContain('蕴金戒')
    await w.find('[data-cell="0"]').trigger('click')
    await w.findAll('button').find((b) => b.text() === '恢复此法宝')!.trigger('click')
    await w.find('[data-cell="1"]').trigger('click')
    await w.findAll('.overlap-choices button').find((b) => b.text().startsWith('1,2'))!.trigger('click')
    await w.findAll('button').find((b) => b.text() === '设为空格')!.trigger('click')
    expect(Number(w.find('.review-cell[aria-current="true"]').attributes('data-cell'))).toBe(0)
    expect(w.find('.current-label').text()).toContain('分金刀')
    expect(w.find('.current-label').text()).not.toContain('占用格')
  })
  it('「记住这个样子」写入本地存储并标记该格已确认；可整体清除', async () => {
    const w = create()
    await upload(w)
    expect(appStore().load('ocrSamples')).toBeNull()
    await w.findAll('button').find((b) => b.text() === '记住这个样子')!.trigger('click')
    await flushPromises()
    const saved = appStore().load('ocrSamples')
    expect(saved?.samples).toHaveLength(1)
    expect(saved?.samples[0].equipId).toBe(110101)
    expect(w.text()).toContain('已记住')

    // 再次识别时会带上学习样本
    await w.findAll('button').find((b) => b.text() === '自动重新识别')!.trigger('click')
    await flushPromises()
    const job = vi.mocked(runRecognition).mock.calls.at(-1)
    expect(job?.[4]?.length).toBe(1)

    await w.findAll('button').find((b) => b.text() === '清除学习记录')!.trigger('click')
    await flushPromises()
    expect(appStore().load('ocrSamples')).toBeNull()
    expect(w.text()).toContain('已清除全部学习记录')
  })

  it('未确认的红装导入失败，不产生部分写入', () => {
    const bag = useBagStore(); bag.add(110101)
    const before = JSON.stringify(bag.$state)
    const cells = draft(); cells[1].kind = 'unknown'; cells[1].confirmed = false
    expect(bag.importRecognition(cells).ok).toBe(false)
    expect(JSON.stringify(bag.$state)).toBe(before)
  })
})
