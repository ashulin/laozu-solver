/** 一次求解的完整生命周期（不持久化） */
import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import { GAME, scoringData } from '@/core/data'
import { buildContext, buildInstances } from '@/core/solver/instances'
import { toSavedPieces } from '@/core/solver/layout-score'
import { placementsFromSnapshot } from '@/core/solver/placement'
import type { BoardMode, Instance, Milestone, Placement, SolveResult, SolverContext } from '@/core/types'
import { browserWorkerFactory, startSolve, type LiveUpdate, type SolveHandle, type WorkerFactory } from '@/services/solver-service'
import { useBagStore } from './bag'
import { useEldersStore } from './elders'
import { useSettingsStore } from './settings'

export const MAX_LOG_LINES = 300

let workerFactory: WorkerFactory = browserWorkerFactory
/** 测试用：替换 Worker 工厂 */
export function setWorkerFactory(f: WorkerFactory | null) {
  workerFactory = f ?? browserWorkerFactory
}

interface RunContext {
  instances: Instance[]
  ctx: SolverContext
}

export const useSolverStore = defineStore('solver', {
  state: () => ({
    running: false,
    startedAt: 0,
    budgetSec: 0,
    live: null as LiveUpdate | null,
    result: null as SolveResult | null,
    milestones: [] as Milestone[],
    replayIndex: null as number | null, // null = 显示最新
    log: [] as string[],
    boardMode: (useBagStore().previousLayout ? 'current' : 'edit') as BoardMode,
    run: null as RunContext | null,
    handle: null as SolveHandle | null,
    error: null as string | null,
  }),
  getters: {
    /** 「实时摆盘」视图应显示的摆放：回放点 > 实时最优 > 最终结果 */
    layoutPlacements(s): Placement[] | null {
      if (!s.run) return null
      const snap = s.replayIndex !== null && s.milestones[s.replayIndex]
        ? s.milestones[s.replayIndex].snap
        : s.running ? s.live?.snap : s.result?.layout
      if (!snap) return null
      return placementsFromSnapshot(s.run.instances, s.run.ctx, scoringData(), snap)
    },
    layoutScore(s): number | null {
      if (s.replayIndex !== null && s.milestones[s.replayIndex]) return s.milestones[s.replayIndex].score
      return s.running ? (s.live?.score ?? null) : (s.result?.score ?? null)
    },
    resultPieces(s) {
      return s.result && s.run ? toSavedPieces(s.run.instances, s.result.layout) : null
    },
  },
  actions: {
    appendLog(line: string) {
      this.log.push(line)
      if (this.log.length > MAX_LOG_LINES) this.log.splice(0, this.log.length - MAX_LOG_LINES)
    },
    start(): boolean {
      if (this.running) return false
      const bag = useBagStore()
      const elders = useEldersStore()
      const settings = useSettingsStore()
      const instances = buildInstances(bag.selected, GAME)
      if (!instances.length) {
        this.appendLog('请先在法宝目录中添加法宝。')
        return false
      }
      const ctx = buildContext(instances, {
        elderConfigs: elders.configMap,
        talents: settings.talents,
        target: settings.target,
        weights: settings.weights,
        fillAll: settings.fillAll,
        locked: bag.lockedCells,
      }, GAME)
      for (const w of bag.warnings) this.appendLog(`⚠ ${w}`)
      if (bag.totalCells > bag.usableCells) this.appendLog(`⚠ 法宝共需 ${bag.totalCells} 格，可用仅 ${bag.usableCells} 格，部分法宝放不下`)

      this.run = markRaw({ instances, ctx })
      this.running = true
      this.error = null
      this.live = null
      this.result = null
      this.milestones = []
      this.replayIndex = null
      this.boardMode = 'layout'
      this.startedAt = Date.now()
      this.budgetSec = settings.budgetSec
      const handle = startSolve(
        { instances, ctx, data: scoringData(), budgetSec: settings.budgetSec, seed: settings.seed, threads: settings.threadCount },
        workerFactory,
        {
          onLive: (u) => { this.live = markRaw(u) },
          onMilestone: (m) => { this.milestones.push(markRaw(m)) },
          onLog: (s) => this.appendLog(s),
        },
      )
      this.handle = markRaw(handle)
      handle.promise
        .then(({ result, milestones }) => {
          this.result = result ? markRaw(result) : null
          this.milestones = milestones.map((m) => markRaw(m))
        })
        .catch((e: Error) => {
          this.error = e.message
        })
        .finally(() => {
          this.running = false
          this.handle = null
        })
      return true
    },
    stop() {
      this.handle?.stop()
    },
    setReplay(index: number | null) {
      this.replayIndex = index
    },
    setBoardMode(mode: BoardMode) {
      this.boardMode = mode
    },
  },
})
