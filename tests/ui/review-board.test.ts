// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ReviewBoard from '@/components/recognize/ReviewBoard.vue'
import BoardGrid from '@/components/board/BoardGrid.vue'
import { rebuildCoverage, setExcluded } from '@/core/ocr/draft'
import { matchesReviewFilter, reviewFootprints, reviewStatus, reviewTargets } from '@/core/ocr/review-board'
import type { RecognitionCell } from '@/core/ocr/recognize'

const empty = (): RecognitionCell[] => Array.from({ length: 42 }, (_, index) => ({ row: Math.floor(index / 7), col: index % 7,
  kind: 'empty', equipId: null, awaken: null, confirmed: true, candidates: [], reason: '' }))
const place = (cells: RecognitionCell[], index: number, id: number, confirmed = true) => {
  Object.assign(cells[index], { kind: 'piece', equipId: id, awaken: 0, confirmed })
  rebuildCoverage(cells)
}

describe('图形核对背包', () => {
  it('复用优化器圆角背包，状态筛选只淡化不隐藏占格', async () => {
    const cells = empty()
    place(cells, 0, 140102, false)
    place(cells, 3, 140101)
    const w = mount(ReviewBoard, { props: { cells, activeIndex: 0, filter: 'pending' } })
    expect(w.findAll('.review-cell')).toHaveLength(42)
    expect(w.findComponent(BoardGrid).props('pieces')).toHaveLength(2)
    expect(w.find('[data-cell="0"]').classes()).toContain('pending')
    expect(w.find('[data-cell="1"]').classes()).toContain('selected')
    expect(w.find('[data-cell="3"]').classes()).toContain('muted')
    const before = w.findComponent(BoardGrid).props('pieces').map((p) => p.cells)
    await w.setProps({ filter: 'all' })
    expect(w.find('[data-cell="3"]').classes()).not.toContain('muted')
    expect(w.findComponent(BoardGrid).props('pieces').map((p) => p.cells)).toEqual(before)
    await w.find('[data-cell="1"]').trigger('click')
    expect(w.emitted('cell-click')).toEqual([[1]])
    w.unmount()
  })
  it('重叠格保留双方命中目标与斜纹，选中对象绘制在最上层', async () => {
    const cells = empty()
    place(cells, 25, 140108)
    place(cells, 33, 110103)
    place(cells, 34, 140103)
    const footprints = reviewFootprints(cells)
    expect(reviewTargets(footprints, 39)).toEqual([25, 33])
    expect(reviewTargets(footprints, 40)).toEqual([33, 34])
    const w = mount(ReviewBoard, { props: { cells, activeIndex: 33 } })
    expect(w.find('[data-cell="39"]').classes()).toContain('overlap')
    expect(w.find('[data-cell="40"]').attributes('aria-label')).toContain('5,7')
    expect(w.findComponent(BoardGrid).props('pieces').at(-1)?.key).toBe('33')
    await w.setProps({ activeIndex: 25 })
    expect(w.findComponent(BoardGrid).props('pieces').at(-1)?.key).toBe('25')
    await w.setProps({ skipPending: true })
    expect(w.find('[data-cell="39"]').classes()).toContain('excluded')
    expect(w.find('[data-cell="39"]').classes()).not.toContain('overlap')
    expect(w.find('[data-cell="40"]').attributes('aria-label')).toContain('5,7')
    w.unmount()
  })
  it('删除或跳过后仍保留灰色占格痕迹，点原位置可恢复', async () => {
    const cells = empty()
    place(cells, 0, 140102, false)
    const snapshot = JSON.stringify(cells)
    const skipped = reviewFootprints(cells, true)
    expect(skipped.find((p) => p.index === 0)?.status).toBe('excluded')
    expect(reviewTargets(skipped, 1)).toEqual([0])
    expect(JSON.stringify(cells)).toBe(snapshot)
    setExcluded(cells, 0, true)
    const w = mount(ReviewBoard, { props: { cells, activeIndex: 0 } })
    expect(w.find('[data-cell="1"]').classes()).toContain('excluded')
    expect(w.findComponent(BoardGrid).props('pieces')[0].cells).toEqual([0, 1])
    expect(reviewTargets(reviewFootprints(cells), 1)).toEqual([0, 1])
    w.unmount()
  })
  it('未识别、锁格和空格都可点击，未知项不凭空画出候选形状', () => {
    const cells = empty()
    Object.assign(cells[5], { kind: 'unknown', confirmed: false, candidates: [{ equipId: 140108, distance: 55 }] })
    cells[41].kind = 'locked'
    const w = mount(ReviewBoard, { props: { cells, activeIndex: 5 } })
    expect(w.find('[data-cell="5"]').text()).toContain('?')
    expect(w.find('[data-cell="41"]').text()).toBe('锁')
    expect(w.findComponent(BoardGrid).props('pieces')).toEqual([])
    expect(reviewTargets(reviewFootprints(cells), 5)).toEqual([5])
    expect(reviewTargets(reviewFootprints(cells), 6)).toEqual([6])
    w.unmount()
  })
  it('人工核对与自动置信区分；冲突优先于人工标记', () => {
    const cells = empty()
    place(cells, 0, 140101)
    expect(reviewStatus(cells[0])).toBe('auto')
    cells[0].manuallyConfirmed = true
    expect(reviewStatus(cells[0])).toBe('checked')
    cells[0].conflicts = ['冲突']
    expect(reviewStatus(cells[0])).toBe('conflict')
    expect(matchesReviewFilter(cells[0], 'ready')).toBe(false)
    expect(matchesReviewFilter(cells[0], 'conflict')).toBe(true)
    expect(matchesReviewFilter(cells[0], 'excluded', true)).toBe(true)
  })
  it('方向键移动焦点，禁用时不能点击修改', async () => {
    const w = mount(ReviewBoard, { props: { cells: empty(), activeIndex: 0 }, attachTo: document.body })
    await w.find('[data-cell="0"]').trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(w.find('[data-cell="7"]').element)
    await w.setProps({ disabled: true })
    await w.find('[data-cell="7"]').trigger('click')
    expect(w.emitted('cell-click')).toBeUndefined()
    w.unmount()
  })
})
