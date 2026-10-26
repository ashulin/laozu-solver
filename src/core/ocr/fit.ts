/**
 * 网格自动定位（移植自原版 fit worker）。思路：
 *   1. 网格打分：42 个格子的底色越接近调色板（品质色/空格/锁格）分越高。
 *   2. 在缩小图上粗搜格宽和左上角，再回到原图分两级细化。
 *   3. 用「元素徽章字形能认出的格子数」（锚点数）在候选里挑最优，并尝试整行/整列平移纠偏。
 * 觉醒版删掉了这一步，只能手动框选；这里补回来。
 */
import { ELEMENT_GLYPHS, GEO, TH } from './model'
import { bestCorrelation, cellBackground, darkRatio, downsample, paletteDistance, type Grid, type RgbImage } from './sampling'

export const ROWS = 6
export const COLS = 7
/** 认出至少这么多个元素徽章，即使底色分不够也算定位成功 */
export const MIN_ANCHORS = 6
/** 底色分低于此值且锚点不足时，直接判失败 */
const MIN_SCORE = 28

export interface FitResult {
  grid: Grid
  score: number // 底色分，满分 42
  anchors: number // 认出元素徽章的格子数
  converged: boolean // false → 界面应提示手动框选
}

/** 网格底色分：每格 max(0, 1 - 调色板距离 / fitFalloff) 求和；有格子完全在图外则为极小值 */
export function gridScore(img: RgbImage, grid: Grid, step?: number): number {
  let score = 0
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const bg = cellBackground(img, grid, r, c, step)
      if (!bg) return -1e9
      score += Math.max(0, 1 - paletteDistance(bg) / TH.fitFalloff)
    }
  }
  return score
}

/**
 * 能认出元素徽章的格子数。quick 模式只看前 10 个候选格、不做平移、阈值放宽，用于给候选粗排序。
 */
export function countAnchors(img: RgbImage, grid: Grid, quick = false): number {
  const margin = grid.pw * 0.12
  let found = 0
  let candidates = 0
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = grid.ox + c * grid.pw
      const y = grid.oy + r * grid.ph
      if (x < -margin || y < -margin || x + grid.pw > img.w + margin || y + grid.ph > img.h + margin) continue
      if (darkRatio(img, grid, r, c, GEO.badgeBox) <= TH.anchorCandidate) continue
      if (quick && ++candidates > 10) return found
      let best = -2
      let second = -2
      for (const tpl of ELEMENT_GLYPHS.values()) {
        const v = quick ? bestCorrelation(img, grid, r, c, GEO.elementBox, tpl, [0]) : bestCorrelation(img, grid, r, c, GEO.elementBox, tpl)
        if (v > best) { second = best; best = v } else if (v > second) second = v
      }
      const ok = quick
        ? best >= 0.35
        : best >= TH.glyphCorr && best - second >= TH.glyphMargin && best + 2 * (best - second) >= TH.glyphCombined
      if (ok) found++
    }
  }
  return found
}

interface Cand { s: number; ox: number; oy: number; p: number }
interface Scored extends Cand { anchors: number }

const toGrid = (c: { ox: number; oy: number; p: number }): Grid => ({ ox: c.ox, oy: c.oy, pw: c.p, ph: c.p })
const fallback = (img: RgbImage): Grid => ({ ox: 0, oy: 0, pw: img.w / COLS, ph: img.h / ROWS })

/** 以 c 为中心，按 steps 逐级在 (格宽, x, y) 上 ±3 步邻域里找底色分更高的位置 */
function refine(img: RgbImage, start: Omit<Cand, 's'>, steps: number[], bgStep?: number, fixedPitch = false): Cand {
  let best: Cand = { ...start, s: gridScore(img, toGrid(start), bgStep) }
  for (const step of steps) {
    const center = { ...best }
    for (let dp = fixedPitch ? 0 : -3; dp <= (fixedPitch ? 0 : 3); dp++) {
      for (let dx = -3; dx <= 3; dx++) {
        for (let dy = -3; dy <= 3; dy++) {
          if (dp === 0 && dx === 0 && dy === 0) continue
          const p = center.p + dp * step
          if (p < 30) continue
          const g = { ox: center.ox + dx * step, oy: center.oy + dy * step, p }
          const s = gridScore(img, toGrid(g), bgStep)
          if (s > best.s) best = { ...g, s }
        }
      }
    }
  }
  return best
}

const withAnchors = (img: RgbImage, c: Cand): Scored => ({ ...c, anchors: countAnchors(img, toGrid(c)) })
const better = (a: Scored, b: Scored | null) => !b || a.anchors > b.anchors || (a.anchors === b.anchors && a.s > b.s)

export function fitGrid(img: RgbImage): FitResult {
  // 背包宽度约为截图宽度的 7/7.6，格宽在估计值的 0.82~1.2 倍之间搜索
  const est = img.w / 7.6
  const factor = Math.max(1, Math.round(est / 36))
  const small = downsample(img, factor)
  const estSmall = est / factor

  // 1. 缩小图粗搜：每种格宽保留最好的一个位置
  const byPitch = new Map<number, Cand>()
  for (let p = estSmall * 0.82; p <= estSmall * 1.2; p += 1) {
    if (COLS * p > small.w + 4 || ROWS * p > small.h + 4) continue
    for (let ox = -3; ox <= small.w - COLS * p + 3; ox += 3) {
      for (let oy = -3; oy <= small.h - ROWS * p + 3; oy += 3) {
        const s = gridScore(small, { ox, oy, pw: p, ph: p }, 0.06)
        const key = Math.round(p)
        const cur = byPitch.get(key)
        if (!cur || s > cur.s) byPitch.set(key, { s, ox, oy, p })
      }
    }
  }
  if (!byPitch.size) return { grid: fallback(img), score: 0, anchors: 0, converged: false }

  // 2. 回到原图：先固定格宽细化位置，再按「快速锚点数」挑 4 个做全参数细化
  const top = [...byPitch.values()].sort((a, b) => b.s - a.s).slice(0, 10)
  const finalists = top
    .map((c) => refine(img, { ox: c.ox * factor, oy: c.oy * factor, p: c.p * factor }, [factor * 2, factor], 0.06, true))
    .map((c) => ({ ...c, s: gridScore(img, toGrid(c)), quick: countAnchors(img, toGrid(c), true) }))
    .sort((a, b) => b.quick - a.quick || b.s - a.s)
    .slice(0, 4)
    .map((c) => refine(img, c, [1, 0.25]))

  let best: Scored | null = null
  for (const c of finalists) {
    const s = withAnchors(img, c)
    if (better(s, best)) best = s
  }

  // 3. 结果不理想时在原图上做一次更宽的搜索兜底
  if (!best || (best.anchors < MIN_ANCHORS && best.s < TH.fitConverged)) {
    const wide = new Map<number, Cand>()
    for (let p = est * 0.82; p <= est * 1.2; p += 2.5) {
      if (COLS * p > img.w + 8 || ROWS * p > img.h + 8) continue
      for (let ox = -5; ox <= img.w - COLS * p + 5; ox += 10) {
        for (let oy = -5; oy <= img.h - ROWS * p + 5; oy += 10) {
          const s = gridScore(img, { ox, oy, pw: p, ph: p }, 0.06)
          const key = Math.round(p / 5)
          const cur = wide.get(key)
          if (!cur || s > cur.s) wide.set(key, { s, ox, oy, p })
        }
      }
    }
    for (const c of [...wide.values()].sort((a, b) => b.s - a.s).slice(0, 3)) {
      const s = withAnchors(img, refine(img, c, [1.5, 0.5, 0.25]))
      if (better(s, best)) best = s
    }
  }
  if (!best) return { grid: fallback(img), score: 0, anchors: 0, converged: false }

  // 4. 整行/整列错位纠偏：上下左右各平移一格，锚点数更多就采用（最多两轮）
  for (let round = 0; round < 2; round++) {
    const base: Scored = best
    let moved = false
    for (const c of [
      { ...base, oy: base.oy - base.p }, { ...base, oy: base.oy + base.p },
      { ...base, ox: base.ox - base.p }, { ...base, ox: base.ox + base.p },
    ]) {
      const s = withAnchors(img, { ...c, s: gridScore(img, toGrid(c)) })
      if (s.anchors > best.anchors) { best = s; moved = true }
    }
    if (!moved) break
  }

  if (best.s < MIN_SCORE && best.anchors < MIN_ANCHORS) {
    return { grid: fallback(img), score: best.s, anchors: best.anchors, converged: false }
  }
  return {
    grid: toGrid(best),
    score: best.s,
    anchors: best.anchors,
    converged: best.s >= TH.fitConverged || best.anchors >= MIN_ANCHORS,
  }
}
