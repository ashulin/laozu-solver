/**
 * 背包四视图 → 统一的渲染模型。
 *  - edit：只显示未开放格（点击切换）
 *  - layout：实时摆盘（求解中为实时最优；可回放里程碑；结束后为最终解），按本次求解的上下文计分
 *  - current：截图导入时记录的游戏内原摆法，按当前设置重新计分
 *  - saved：选中的收藏摆盘，按当前设置重新计分
 */
import { computed, ref } from 'vue'
import { GAME, scoringData } from '@/core/data'
import { evaluate, objective } from '@/core/solver/evaluate'
import { scoreLayout } from '@/core/solver/layout-score'
import type { ElementId, EvaluatedPiece, SavedPiece, Tier } from '@/core/types'
import { useBagStore } from '@/stores/bag'
import { useBoardsStore } from '@/stores/boards'
import { useEldersStore } from '@/stores/elders'
import { useSettingsStore } from '@/stores/settings'
import { useSolverStore } from '@/stores/solver'

export interface BoardPiece {
  key: string
  equipId: number
  name: string
  tier: Tier
  element: ElementId
  awaken: number
  cells: number[]
  detail?: EvaluatedPiece
}

export interface BoardModel {
  pieces: BoardPiece[]
  score: number | null
  invalidCount: number
  live: boolean
}

const selectedBoard = ref<string | null>(null)

export function useBoardView() {
  const bag = useBagStore()
  const elders = useEldersStore()
  const settings = useSettingsStore()
  const solver = useSolverStore()
  const boards = useBoardsStore()

  const ctxInput = () => ({
    elderConfigs: elders.configs, talents: settings.talents, target: settings.target,
    weights: settings.weights, fillAll: false, locked: bag.lockedCells,
  })

  const fromSaved = (pieces: SavedPiece[]): BoardModel => {
    const s = scoreLayout(pieces, ctxInput(), GAME)
    return {
      pieces: s.placements.map((p, i) => ({
        key: `s${i}`, equipId: p.eq.id, name: p.eq.name, tier: p.tier, element: p.eq.element,
        awaken: p.inst.awaken, cells: p.cells, detail: s.evaluation.pieces[i],
      })),
      score: s.score,
      invalidCount: s.invalid.length,
      live: false,
    }
  }

  const savedBoard = computed(() => boards.boards.find((b) => b.name === selectedBoard.value) ?? boards.boards[0] ?? null)

  const layoutModel = computed<BoardModel | null>(() => {
    const pl = solver.layoutPlacements
    if (!pl || !solver.run) return null
    const ev = evaluate(pl, solver.run.ctx, scoringData(), true)
    return {
      pieces: pl.map((p, i) => ({
        key: `u${p.inst.uid}`, equipId: p.eq.id, name: p.eq.name, tier: p.tier, element: p.eq.element,
        awaken: p.inst.awaken, cells: p.cells, detail: ev.pieces[i],
      })),
      score: objective(ev, solver.run.ctx.target),
      invalidCount: 0,
      live: solver.running && solver.replayIndex === null,
    }
  })

  const model = computed<BoardModel>(() => {
    switch (solver.boardMode) {
      case 'layout':
        return layoutModel.value ?? { pieces: [], score: null, invalidCount: 0, live: false }
      case 'current':
        return bag.previousLayout ? fromSaved(bag.previousLayout) : { pieces: [], score: null, invalidCount: 0, live: false }
      case 'saved':
        return savedBoard.value ? fromSaved(savedBoard.value.pieces) : { pieces: [], score: null, invalidCount: 0, live: false }
      default:
        return { pieces: [], score: null, invalidCount: 0, live: false }
    }
  })

  /** 得分对比基准：实时摆盘的分数（不在 layout 视图时才对比） */
  const compareBase = computed(() => (solver.boardMode === 'current' || solver.boardMode === 'saved') ? (layoutModel.value?.score ?? null) : null)

  return {
    model,
    compareBase,
    savedBoard,
    selectedBoard,
    hasLayout: computed(() => !!layoutModel.value),
    hasCurrent: computed(() => !!bag.previousLayout),
    hasSaved: computed(() => boards.boards.length > 0),
  }
}
