import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { GAME } from '@/core/data'
import { runSingleLine } from '@/core/solver/anneal'
import { memoryStorage, setStorageBackend } from '@/services/app-storage'
import type { WorkerLike } from '@/services/solver-service'
import { KEYS, type StorageLike } from '@/services/storage'
import type { SolverJobMsg } from '@/workers/protocols'
import { useBagStore } from '@/stores/bag'
import { useBoardsStore } from '@/stores/boards'
import { useEldersStore } from '@/stores/elders'
import { enableAutoPersist } from '@/stores/persist'
import { useSettingsStore } from '@/stores/settings'
import { MAX_LOG_LINES, setWorkerFactory, useSolverStore } from '@/stores/solver'
import { fakeClock } from '../reference/load'

const swk = GAME.elders.find((e) => e.name === '孙悟空')!
const ce = GAME.elders.find((e) => e.name === '嫦娥')!
const gg = GAME.elders.find((e) => e.name === '共工')!
const dp = GAME.elders.find((e) => e.name === '大鹏')!
const JGB = swk.redEquipId

let mem: StorageLike
beforeEach(() => {
  mem = memoryStorage()
  setStorageBackend(mem)
  setActivePinia(createPinia())
})

describe('elders store', () => {
  it('未配置的长老默认未拥有、0 星、上限 0', () => {
    expect(useEldersStore().config(swk.id)).toEqual({ elderId: swk.id, owned: false, star: 0, awakenCap: 0 })
  })

  it('星级与觉醒上限被截断到合法范围', () => {
    const s = useEldersStore()
    s.setStar(swk.id, 9)
    s.setAwakenCap(swk.id, 9)
    s.setAwakenCap(dp.id, 5)
    expect(s.config(swk.id)).toMatchObject({ star: 5, awakenCap: 5 })
    expect(s.config(dp.id).awakenCap).toBe(3)
  })

  it('views 包含 80 位长老，可携带数量随星级变化', () => {
    const s = useEldersStore()
    s.setOwned(swk.id, true)
    const v = () => s.views.find((x) => x.elder.id === swk.id)!
    expect(s.views).toHaveLength(80)
    expect(v().maxCopies).toBe(1)
    s.setStar(swk.id, 3)
    expect(v().maxCopies).toBe(2)
    expect(v().redEquip.name).toBe('如意金箍棒')
  })

  it('下调觉醒上限时，已选副本被压到新上限', () => {
    const e = useEldersStore()
    const bag = useBagStore()
    e.update(swk.id, { owned: true, star: 3, awakenCap: 4 })
    bag.add(JGB, 2)
    bag.setCopyAwaken(JGB, 1, 1)
    e.setAwakenCap(swk.id, 2)
    expect(bag.selected[0].copies.map((c) => c.awaken)).toEqual([2, 1])
  })
})

describe('bag store', () => {
  it('普通法宝可直接添加，统计件数与格数', () => {
    const bag = useBagStore()
    expect(bag.add(140101, 3)).toEqual({ ok: true })
    expect(bag.totalPieces).toBe(3)
    expect(bag.totalCells).toBe(3)
    bag.removeCopy(140101)
    expect(bag.countOf(140101)).toBe(2)
  })

  it('红装：未拥有拒绝；新副本觉醒默认取上限；超出可携带数量拒绝', () => {
    const bag = useBagStore()
    const e = useEldersStore()
    expect(bag.add(JGB)).toMatchObject({ ok: false, reason: expect.stringContaining('标记为已拥有') })
    e.update(swk.id, { owned: true, star: 2, awakenCap: 3 })
    expect(bag.add(JGB)).toEqual({ ok: true })
    expect(bag.selected[0].copies).toEqual([{ awaken: 3 }])
    expect(bag.add(JGB)).toMatchObject({ ok: false, reason: expect.stringContaining('3 星可带 2 件') })
    e.setStar(swk.id, 3)
    expect(bag.add(JGB)).toEqual({ ok: true })
  })

  it('红装最多 2 种', () => {
    const bag = useBagStore()
    const e = useEldersStore()
    for (const el of [swk, ce, gg]) e.update(el.id, { owned: true, star: 1 })
    expect(bag.add(swk.redEquipId).ok).toBe(true)
    expect(bag.add(ce.redEquipId).ok).toBe(true)
    expect(bag.add(gg.redEquipId)).toMatchObject({ ok: false, reason: expect.stringContaining('最多 2 种') })
  })

  it('逐副本设置觉醒：截断到长老上限；普通法宝忽略', () => {
    const bag = useBagStore()
    useEldersStore().update(swk.id, { owned: true, star: 3, awakenCap: 2 })
    bag.add(JGB, 2)
    bag.setCopyAwaken(JGB, 0, 5)
    bag.setCopyAwaken(JGB, 1, 0)
    expect(bag.selected[0].copies.map((c) => c.awaken)).toEqual([2, 0])
    bag.add(140101)
    bag.setCopyAwaken(140101, 0, 3)
    expect(bag.selected[1].copies[0].awaken).toBe(0)
  })

  it('锁格切换', () => {
    const bag = useBagStore()
    bag.toggleLocked(6)
    bag.toggleLocked(41)
    bag.toggleLocked(99)
    expect(bag.lockedCells).toEqual([6, 41])
    expect(bag.usableCells).toBe(40)
    bag.toggleLocked(6)
    expect(bag.lockedCells).toEqual([41])
  })

  it('warnings：长老配置变化后实时反映', () => {
    const bag = useBagStore()
    const e = useEldersStore()
    e.update(swk.id, { owned: true, star: 3, awakenCap: 0 })
    bag.add(JGB, 2)
    expect(bag.warnings).toEqual([])
    e.setStar(swk.id, 1)
    expect(bag.warnings).toEqual([expect.stringContaining('最多带 1 件')])
  })
})

describe('settings store', () => {
  it('筛选切换与清空', () => {
    const s = useSettingsStore()
    s.toggleFilter('forms', 6)
    s.toggleFilter('cellCounts', 2)
    expect(s.hasFilters).toBe(true)
    s.toggleFilter('forms', 6)
    expect(s.catalogFilters.forms).toEqual([])
    s.clearFilters()
    expect(s.hasFilters).toBe(false)
  })

  it('线程数：auto 时按核数自适应', () => {
    const s = useSettingsStore()
    expect(s.threadCount).toBeGreaterThanOrEqual(2)
    s.threads = 4
    expect(s.threadCount).toBe(4)
  })
})

describe('boards store', () => {
  it('同名覆盖、新的在前', () => {
    const b = useBoardsStore()
    b.save('A', [], 1, 'power')
    b.save('B', [], 2, 'power')
    b.save('A', [], 3, 'power')
    expect(b.boards.map((x) => [x.name, x.score])).toEqual([['B', 2], ['A', 3]])
  })
})

describe('自动持久化', () => {
  it('修改后写入存储，新会话能读回', () => {
    const stop = enableAutoPersist()
    useEldersStore().update(swk.id, { owned: true, star: 4, awakenCap: 2 })
    useBagStore().add(JGB)
    useSettingsStore().toggleFilter('forms', 6)
    useBoardsStore().save('我的摆盘', [{ equipId: JGB, awaken: 2, r: 0, c: 0 }], 123, 'power')
    stop()
    expect(mem.getItem(KEYS.elders)).toBeTruthy()

    setActivePinia(createPinia())
    expect(useEldersStore().config(swk.id)).toEqual({ elderId: swk.id, owned: true, star: 4, awakenCap: 2 })
    expect(useBagStore().selected).toEqual([{ equipId: JGB, copies: [{ awaken: 2 }] }])
    expect(useSettingsStore().catalogFilters.forms).toEqual([6])
    expect(useBoardsStore().boards[0].name).toBe('我的摆盘')
  })
})

describe('solver store', () => {
  class InstantWorker implements WorkerLike {
    onmessage: WorkerLike['onmessage'] = null
    onerror: WorkerLike['onerror'] = null
    postMessage(job: SolverJobMsg) {
      queueMicrotask(() => {
        const r = runSingleLine({ ...job, budgetMs: 2000, now: fakeClock(), onProgress: (p) => this.onmessage?.({ data: { type: 'progress', workerId: job.workerId, ...p } }) })
        this.onmessage?.({ data: { type: 'done', workerId: job.workerId, ...r } })
      })
    }
    terminate() {}
  }

  it('没有法宝时不启动', () => {
    const s = useSolverStore()
    expect(s.start()).toBe(false)
    expect(s.log[0]).toContain('请先')
  })

  it('完整跑一次：切到实时摆盘视图，得到结果与可回放的里程碑', async () => {
    setWorkerFactory(() => new InstantWorker())
    useEldersStore().update(swk.id, { owned: true, star: 5, awakenCap: 3 })
    const bag = useBagStore()
    bag.add(JGB)
    bag.add(140101, 4)
    bag.add(140104, 2)
    useSettingsStore().threads = 2
    const s = useSolverStore()
    expect(s.start()).toBe(true)
    expect(s.running).toBe(true)
    expect(s.boardMode).toBe('layout')
    expect(s.start()).toBe(false) // 运行中不能重复启动
    await s.handle!.promise
    await new Promise((r) => setTimeout(r, 0)) // 等 then/finally 链结算
    expect(s.running).toBe(false)
    expect(s.result!.placedCount).toBe(7)
    expect(s.layoutPlacements).toHaveLength(7)
    expect(s.layoutScore).toBe(s.result!.score)
    expect(s.resultPieces!.find((p) => p.equipId === JGB)).toMatchObject({ awaken: 3 })
    expect(s.milestones.length).toBeGreaterThan(0)
    s.setReplay(0)
    expect(s.layoutScore).toBe(s.milestones[0].score)
    setWorkerFactory(null)
  })

  it('日志封顶', () => {
    const s = useSolverStore()
    for (let i = 0; i < MAX_LOG_LINES + 50; i++) s.appendLog(String(i))
    expect(s.log).toHaveLength(MAX_LOG_LINES)
    expect(s.log[0]).toBe('50')
  })
})
