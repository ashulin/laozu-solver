// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { GAME } from '@/core/data'
import { runSingleLine } from '@/core/solver/anneal'
import { memoryStorage, setStorageBackend } from '@/services/app-storage'
import type { WorkerLike } from '@/services/solver-service'
import type { SolverJobMsg } from '@/workers/protocols'
import { useBoardView, type BoardPiece } from '@/composables/board-view'
import { useBagStore } from '@/stores/bag'
import { useBoardsStore } from '@/stores/boards'
import { useEldersStore } from '@/stores/elders'
import { useSettingsStore } from '@/stores/settings'
import { setWorkerFactory, useSolverStore } from '@/stores/solver'
import BoardGrid from '@/components/board/BoardGrid.vue'
import BoardPanel from '@/components/board/BoardPanel.vue'
import EquipCatalog from '@/components/catalog/EquipCatalog.vue'
import SelectedList from '@/components/selected/SelectedList.vue'
import SolveSettings from '@/components/settings/SolveSettings.vue'
import SolverView from '@/views/SolverView.vue'
import { fakeClock } from '../reference/load'

const swk = GAME.elders.find((e) => e.name === '孙悟空')!
const JGB = swk.redEquipId

class InstantWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null
  onerror: WorkerLike['onerror'] = null
  postMessage(job: SolverJobMsg) {
    queueMicrotask(() => {
      const r = runSingleLine({ ...job, budgetMs: 1500, now: fakeClock(), onProgress: (p) => this.onmessage?.({ data: { type: 'progress', workerId: job.workerId, ...p } }) })
      this.onmessage?.({ data: { type: 'done', workerId: job.workerId, ...r } })
    })
  }
  terminate() {}
}

const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  setStorageBackend(memoryStorage())
  setActivePinia(createPinia())
  setWorkerFactory(() => new InstantWorker())
})

async function solveOnce() {
  useEldersStore().update(swk.id, { owned: true, star: 5, awakenCap: 3 })
  const bag = useBagStore()
  bag.add(JGB)
  bag.add(140101, 3)
  bag.add(140104, 2)
  useSettingsStore().threads = 2
  const s = useSolverStore()
  s.start()
  await s.handle!.promise
  await settle()
  return s
}

describe('useBoardView', () => {
  it('layout 视图：显示最终解，分数与求解结果一致', async () => {
    const s = await solveOnce()
    const v = useBoardView()
    expect(v.model.value.pieces).toHaveLength(s.result!.placedCount)
    expect(v.model.value.score).toBe(s.result!.score)
    expect(v.model.value.pieces.find((p) => p.equipId === JGB)!.awaken).toBe(3)
    expect(v.compareBase.value).toBeNull()
  })

  it('saved / current 视图：按当前设置重新计分，并与实时摆盘对比', async () => {
    const s = await solveOnce()
    useBoardsStore().save('A', s.resultPieces!, s.result!.score, 'power')
    useBagStore().setPreviousLayout(s.resultPieces!.slice(0, 2))
    const v = useBoardView()
    s.setBoardMode('saved')
    expect(v.model.value.score).toBeCloseTo(s.result!.score, 6)
    expect(v.compareBase.value).toBeCloseTo(s.result!.score, 6)
    s.setBoardMode('current')
    expect(v.model.value.pieces).toHaveLength(2)
    expect(v.model.value.score!).toBeLessThan(s.result!.score)
  })

  it('edit 视图无法宝', () => {
    expect(useBoardView().model.value.pieces).toEqual([])
  })
})

describe('BoardGrid', () => {
  const p = (key: string, cells: number[], tier: 1 | 5 = 1): BoardPiece => ({ key, equipId: 1, name: key, tier, element: 1, awaken: 0, cells })

  it('42 格；同件内部无描边、与其它件相邻处有描边；锚点显示编号', () => {
    const w = mount(BoardGrid, { props: { pieces: [p('a', [0, 1]), p('b', [2], 5)], locked: [41] } })
    const cells = w.findAll('.cell')
    expect(cells).toHaveLength(42)
    expect(cells[0].classes()).toContain('el')
    expect(cells[0].classes()).not.toContain('er') // 与同件右邻
    expect(cells[1].classes()).toContain('er') // 与另一件相邻
    expect(cells[0].find('.tag').text()).toContain('1')
    expect(cells[1].find('.tag').exists()).toBe(false)
    expect(cells[41].classes()).toContain('locked')
  })

  it('编辑模式点击切换锁格；查看模式点击选中法宝', async () => {
    const w = mount(BoardGrid, { props: { pieces: [p('a', [0])], locked: [], editable: true } })
    await w.findAll('.cell')[5].trigger('click')
    expect(w.emitted('toggle-lock')).toEqual([[5]])
    await w.setProps({ editable: false })
    await w.findAll('.cell')[0].trigger('click')
    expect(w.emitted('select')).toEqual([['a']])
  })
})

describe('EquipCatalog', () => {
  it('形态 + 占格数筛选后添加到已选', async () => {
    const w = mount(EquipCatalog)
    const chip = (text: string) => w.findAll('.chip').find((c) => c.text().startsWith(text))!
    await chip('枪').trigger('click')
    await chip('1格').trigger('click')
    expect(useSettingsStore().catalogFilters).toMatchObject({ forms: [6], cellCounts: [1] })
    const names = w.findAll('.item .name').map((n) => n.text())
    expect(names.length).toBe(0) // 没有 1 格的枪
    await chip('1格').trigger('click')
    await chip('2格').trigger('click')
    const items = w.findAll('.item')
    expect(items.length).toBeGreaterThan(0)
    await items[0].findAll('button').find((b) => b.text() === '添加')!.trigger('click')
    expect(useBagStore().totalPieces).toBe(1)
  })

  it('搜长老名找到红装；未拥有时置灰且添加被拒绝', async () => {
    useEldersStore().setOwned(swk.id, false)
    useSettingsStore().catalogFilters.keyword = '孙悟空'
    const w = mount(EquipCatalog)
    const items = w.findAll('.item')
    expect(items).toHaveLength(1)
    expect(items[0].classes()).toContain('dim')
    expect(items[0].text()).toContain('孙悟空')
    await items[0].findAll('button').find((b) => b.text() === '添加')!.trigger('click')
    expect(useBagStore().totalPieces).toBe(0)
  })
})

describe('SelectedList', () => {
  it('红装逐副本设置觉醒，选项不超过长老上限', async () => {
    useEldersStore().update(swk.id, { owned: true, star: 3, awakenCap: 2 })
    useBagStore().add(JGB, 2)
    const w = mount(SelectedList)
    const selects = w.findAll('.copies select')
    expect(selects).toHaveLength(2)
    expect(selects[0].findAll('option')).toHaveLength(3)
    await selects[1].setValue('0')
    expect(useBagStore().selected[0].copies.map((c) => c.awaken)).toEqual([2, 0])
  })

  it('显示校验提示', () => {
    useEldersStore().update(swk.id, { owned: true, star: 3 })
    useBagStore().add(JGB, 2)
    useEldersStore().setStar(swk.id, 1)
    expect(mount(SelectedList).find('.warns').text()).toContain('最多带 1 件')
  })
})

describe('SolveSettings + BoardPanel', () => {
  it('点击开始求解 → 完成后切到实时摆盘并显示分数，可收藏', async () => {
    useEldersStore().update(swk.id, { owned: true, star: 5, awakenCap: 3 })
    useBagStore().add(JGB)
    useBagStore().add(140101, 3)
    useSettingsStore().threads = 2
    const w = mount(SolverView)
    await w.findAll('button').find((b) => b.text() === '开始求解')!.trigger('click')
    await useSolverStore().handle?.promise
    await settle()
    await w.vm.$nextTick()
    const panel = w.findComponent(BoardPanel)
    expect(panel.find('.big').text()).not.toBe('')
    expect(panel.findAll('.cell .tag')).toHaveLength(4)
    vi.stubGlobal('prompt', () => '测试摆盘')
    await panel.findAll('button').find((b) => b.text() === '收藏这份摆盘')!.trigger('click')
    expect(useBoardsStore().boards[0].name).toBe('测试摆盘')
    expect(w.findComponent(SolveSettings).find('.progress i').attributes('style')).toContain('100%')
  })

  it('选择弟子天赋写回设置', async () => {
    const w = mount(SolveSettings, { attachTo: document.body })
    const id = GAME.talents.find((t) => t.name === '剑痴')!.id
    const picker = w.findAll('.talent-picker')[0]
    await picker.find('.trigger').trigger('click')
    await picker.findAll('.form-btn').find((b) => b.text().startsWith('剑'))!.trigger('click')
    await picker.findAll('.talent-btn').find((b) => b.text().includes('剑痴'))!.trigger('click')
    expect(useSettingsStore().talents[0]).toBe(id)
    w.unmount()
  })
})

describe('bag.adoptLayout', () => {
  it('同款合并，保留各自觉醒等级', () => {
    const bag = useBagStore()
    bag.adoptLayout([
      { equipId: JGB, awaken: 3, r: 0, c: 0 }, { equipId: JGB, awaken: 0, r: 2, c: 2 },
      { equipId: 140101, awaken: 0, r: 5, c: 6 }, { equipId: 1, awaken: 0, r: 4, c: 4 },
    ])
    expect(bag.selected).toEqual([
      { equipId: JGB, copies: [{ awaken: 3 }, { awaken: 0 }] },
      { equipId: 140101, copies: [{ awaken: 0 }] },
    ])
  })
})
