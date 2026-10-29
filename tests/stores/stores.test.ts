import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { markRaw } from 'vue'
import { selectedSignature } from '@/core/catalog'
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
  it('默认账号：未配置的长老默认已拥有、0 星、觉醒 0', () => {
    const s = useEldersStore()
    expect(s.config(swk.id)).toEqual({ elderId: swk.id, owned: true, star: 0, awakenCap: 0 })
    expect(s.ownedCount).toBe(GAME.elders.length)
    expect(s.configMap[swk.id].owned).toBe(true)
  })

  it('取消拥有后持久化，新会话仍为未拥有（不会回到默认）', () => {
    const stop = enableAutoPersist()
    useEldersStore().setOwned(swk.id, false)
    stop()
    setActivePinia(createPinia())
    expect(useEldersStore().config(swk.id).owned).toBe(false)
    expect(useEldersStore().config(ce.id).owned).toBe(true)
    expect(useEldersStore().ownedCount).toBe(GAME.elders.length - 1)
  })

  it('星级与觉醒被截断到合法范围', () => {
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

  it('下调长老觉醒时，已选副本被压到新等级', () => {
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
  it('普通法宝可改阶：只动指定的那一件；红装与占格不同的阶拒绝', () => {
    const bag = useBagStore()
    const name = GAME.equips.find((e) => e.elderId === undefined && GAME.equips.filter((x) => x.name === e.name).length > 1)!.name
    const tiers = GAME.equips.filter((e) => e.name === name && e.shapeId === GAME.equips.find((x) => x.name === name)!.shapeId).sort((a, b) => a.tier - b.tier)
    expect(tiers.length).toBeGreaterThan(1)
    bag.add(tiers[0].id, 3)
    const copies = bag.selected.find((it) => it.equipId === tiers[0].id)!.copies
    const middle = copies[1].id!
    expect(bag.setCopyTier(tiers[0].id, middle, tiers[1].tier).ok).toBe(true)
    // 只升了中间那件，其余不变
    expect(bag.countOf(tiers[0].id)).toBe(2)
    expect(bag.countOf(tiers[1].id)).toBe(1)
    expect(bag.totalPieces).toBe(3)
    // 身份不变，能继续指定
    expect(bag.selected.find((it) => it.equipId === tiers[1].id)!.copies[0].id).toBe(middle)
    // 红装不支持
    const elders = useEldersStore()
    elders.update(swk.id, { owned: true, star: 3, awakenCap: 3 })
    bag.add(JGB)
    const redCopy = bag.selected.find((it) => it.equipId === JGB)!.copies[0].id!
    expect(bag.setCopyTier(JGB, redCopy, 4).ok).toBe(false)
    // 不存在的副本
    expect(bag.setCopyTier(tiers[0].id, 'not-exist', tiers[1].tier).ok).toBe(false)
  })

  it('升阶会联动「之前摆盘」里对应的那一件，另一件不动', () => {
    const bag = useBagStore()
    const eq = GAME.equips.find((e) => e.elderId === undefined
      && GAME.equips.some((n) => n.name === e.name && n.shapeId === e.shapeId && n.tier === e.tier + 1))!
    const next = GAME.equips.find((n) => n.name === eq.name && n.shapeId === eq.shapeId && n.tier === eq.tier + 1)!
    bag.add(eq.id, 2)
    bag.setPreviousLayout([
      { equipId: eq.id, awaken: 0, r: 0, c: 0 },
      { equipId: eq.id, awaken: 0, r: 1, c: 0 },
    ])
    const copyId = bag.selected[0].copies[0].id!
    expect(bag.setCopyTier(eq.id, copyId, next.tier).ok).toBe(true)
    expect(bag.previousLayout!.map((p) => p.equipId)).toEqual([next.id, eq.id])
  })

  it('在摆盘上升阶：联动已选列表并更新之前摆盘的位置', () => {
    const bag = useBagStore()
    const eq = GAME.equips.find((e) => e.elderId === undefined
      && GAME.equips.some((n) => n.name === e.name && n.shapeId === e.shapeId && n.tier === e.tier + 1))!
    const next = GAME.equips.find((n) => n.name === eq.name && n.shapeId === eq.shapeId && n.tier === eq.tier + 1)!
    bag.add(eq.id, 1)
    bag.setPreviousLayout([{ equipId: eq.id, awaken: 0, r: 2, c: 3 }])
    expect(bag.upgradePlaced(2, 3).ok).toBe(true)
    expect(bag.previousLayout).toEqual([{ equipId: next.id, awaken: 0, r: 2, c: 3 }])
    expect(bag.selected).toMatchObject([{ equipId: next.id, copies: [{ awaken: 0 }] }])
    // 找不到的位置返回失败
    expect(bag.upgradePlaced(0, 0).ok).toBe(false)
  })

  it('在摆盘上删除：同时移除之前摆盘位置与已选列表的一件', () => {
    const bag = useBagStore()
    bag.add(140101, 2)
    bag.setPreviousLayout([
      { equipId: 140101, awaken: 0, r: 0, c: 0 },
      { equipId: 140101, awaken: 0, r: 1, c: 1 },
    ])
    bag.removePlaced(0, 0)
    expect(bag.previousLayout).toEqual([{ equipId: 140101, awaken: 0, r: 1, c: 1 }])
    expect(bag.countOf(140101)).toBe(1)
  })

  it('在摆盘上改红装觉醒：截断到长老上限并联动已选', () => {
    const elders = useEldersStore()
    elders.update(swk.id, { owned: true, star: 3, awakenCap: 2 })
    const bag = useBagStore()
    bag.add(JGB, 1)
    const anchor = GAME.shapeById[GAME.equipById[JGB].shapeId].cells.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])[0]
    bag.setPreviousLayout([{ equipId: JGB, awaken: 0, r: 0 - anchor[0], c: 0 - anchor[1] }])
    const { r, c } = { r: bag.previousLayout![0].r, c: bag.previousLayout![0].c }
    bag.setPlacedAwaken(r, c, 5) // 超过上限 2 → 截断
    expect(bag.previousLayout![0].awaken).toBe(2)
    expect(bag.selected[0].copies[0].awaken).toBe(2)
  })

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
    e.setOwned(swk.id, false)
    expect(bag.add(JGB)).toMatchObject({ ok: false, reason: expect.stringContaining('标记为已拥有') })
    e.update(swk.id, { owned: true, star: 2, awakenCap: 3 })
    expect(bag.add(JGB)).toEqual({ ok: true })
    expect(bag.selected[0].copies.map((c) => c.awaken)).toEqual([3])
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

  it('形态/占格/品阶是单选：互斥且再点取消；元素仍可多选', () => {
    const s = useSettingsStore()
    s.setFilter('forms', 6)
    expect(s.catalogFilters.forms).toEqual([6])
    s.setFilter('forms', 7)
    expect(s.catalogFilters.forms).toEqual([7]) // 互斥，不是追加
    s.setFilter('forms', 7)
    expect(s.catalogFilters.forms).toEqual([]) // 再点取消
    s.setFilter('cellCounts', 3)
    s.setFilter('tiers', 5)
    expect(s.catalogFilters.cellCounts).toEqual([3])
    expect(s.catalogFilters.tiers).toEqual([5])

    // 元素保持多选
    s.toggleFilter('elements', 1)
    s.toggleFilter('elements', 2)
    expect(s.catalogFilters.elements).toEqual([1, 2])
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
    expect(useBagStore().selected).toMatchObject([{ equipId: JGB, copies: [{ awaken: 2 }] }])
    expect(useSettingsStore().catalogFilters.forms).toEqual([6])
    expect(useBoardsStore().boards[0].name).toBe('我的摆盘')
  })
})

describe('solver store', () => {
  it('求解后背包被修改，结果被标记为过期', () => {
    const solver = useSolverStore()
    const bag = useBagStore()
    bag.add(110101)
    solver.run = markRaw({ instances: [], ctx: {} as never, signature: selectedSignature(bag.selected) })
    expect(solver.stale).toBe(false)
    bag.add(110101)
    expect(solver.stale).toBe(true)
  })

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
