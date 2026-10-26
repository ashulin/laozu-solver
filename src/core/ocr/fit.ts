/**
 * 网格自动定位（移植自原版 fit worker，并做了两处增强）。思路：
 *   1. 网格打分：42 个格子的底色越接近调色板（品质色/空格/锁格）分越高。
 *   2. 在缩小图上粗搜格宽和左上角，再回到原图分两级细化。
 *   3. 用「元素徽章字形能认出的格子数」（锚点数）在候选里挑最优，并尝试整行/整列平移纠偏。
 *   4.（新增）外框纠偏：按背包深棕色边框是否贴合，纠正整行错位（上方面板颜色接近格子底色时原版会错）。
 *   5.（新增）边缘吸附：格宽估错时，按左、右、下三条边框重新确定格宽和位置。
 * 觉醒版删掉了自动定位，只能手动框选；这里补回来。
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
  frame: number // 外框贴合度 0~1
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

/**
 * 外框得分（0~1）：背包下、左、右三侧紧贴网格的是一圈深棕色边框（上方是「法宝」标题牌，不参与）。
 * 在三条边带上采样，统计接近边框色的比例，取三侧平均。网格整行错位或格宽不对时，边带会落进格子或其它面板。
 */
export const FRAME_COLOR: [number, number, number] = [104, 92, 66]
const FRAME_TOLERANCE = 32

function frameBand(img: RgbImage, x0: number, y0: number, x1: number, y1: number): number {
  let hit = 0
  let total = 0
  const sx = Math.max(1, (x1 - x0) / 48)
  const sy = Math.max(1, (y1 - y0) / 48)
  for (let y = y0; y < y1; y += sy) {
    for (let x = x0; x < x1; x += sx) {
      const xx = Math.round(x)
      const yy = Math.round(y)
      if (xx < 0 || yy < 0 || xx >= img.w || yy >= img.h) { total++; continue }
      const p = img.px(xx, yy)
      total++
      if (Math.hypot(p[0] - FRAME_COLOR[0], p[1] - FRAME_COLOR[1], p[2] - FRAME_COLOR[2]) < FRAME_TOLERANCE) hit++
    }
  }
  return total ? hit / total : 0
}

export function frameScore(img: RgbImage, grid: Grid): number {
  const W = COLS * grid.pw
  const H = ROWS * grid.ph
  const t0 = 0.06 * grid.pw
  const t1 = 0.16 * grid.pw
  const below = frameBand(img, grid.ox + 0.1 * grid.pw, grid.oy + H + t0, grid.ox + W - 0.1 * grid.pw, grid.oy + H + t1)
  const left = frameBand(img, grid.ox - t1, grid.oy + 0.1 * grid.ph, grid.ox - t0, grid.oy + H - 0.1 * grid.ph)
  const right = frameBand(img, grid.ox + W + t0, grid.oy + 0.1 * grid.ph, grid.ox + W + t1, grid.oy + H - 0.1 * grid.ph)
  return (below + left + right) / 3
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
  if (!byPitch.size) return { grid: fallback(img), score: 0, anchors: 0, frame: 0, converged: false }

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
  if (!best) return { grid: fallback(img), score: 0, anchors: 0, frame: 0, converged: false }

  // 4. 整行/整列错位纠偏（原版）：上下左右各平移一格，锚点数更多就采用（最多两轮）
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

  // 5. 外框纠偏（新增）：底色分和锚点数在整行错位时常常持平（上方面板颜色也接近格子底色），
  //    而背包下、左、右三侧的深棕色边框只有在网格正确时才贴合。按外框分挑选整行/整列平移。
  let grid = toGrid(best)
  let frame = frameScore(img, grid)
  const base = grid
  const baseFrame = frame
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const g = { ...base, ox: base.ox + dx * base.pw, oy: base.oy + dy * base.ph }
      const f = frameScore(img, g)
      if (f > baseFrame + FRAME_SHIFT_MARGIN && f > frame) { grid = g; frame = f }
    }
  }
  // 6. 边缘吸附（新增）：格宽估错时外框分偏低，直接按左、右、下三条边框重新确定格宽和位置
  if (frame < FRAME_OK) {
    const snapped = snapToFrame(img, grid)
    const f = snapped ? frameScore(img, snapped) : 0
    if (snapped && f > frame) { grid = snapped; frame = f }
  }
  const score = gridScore(img, grid)
  const anchors = countAnchors(img, grid)

  if (score < MIN_SCORE && anchors < MIN_ANCHORS) {
    return { grid: fallback(img), score, anchors, converged: false, frame }
  }
  return {
    grid,
    score,
    anchors,
    frame,
    converged: frame >= FRAME_MIN && (score >= TH.fitConverged || anchors >= MIN_ANCHORS),
  }
}

/** 整行/整列平移须比当前外框分高出这么多才采用，避免噪声误判 */
const FRAME_SHIFT_MARGIN = 0.1
/** 外框分达到此值视为贴合，不再吸附 */
const FRAME_OK = 0.9
/** 外框分低于此值判为定位失败（实测正确网格 0.93~1.00，错位网格 ≤ 0.77） */
export const FRAME_MIN = 0.85

/**
 * 在 x 处竖直（或 y 处水平）切一刀，比较刀两侧窄带里边框色像素的比例。
 * side=-1 表示边框在刀的负方向一侧（左边框、上边框），+1 表示在正方向一侧（右边框、下边框）。
 */
function edgeStrength(img: RgbImage, vertical: boolean, at: number, from: number, to: number, side: -1 | 1, band: number): number {
  const out = vertical
    ? frameBand(img, side < 0 ? at - band : at, from, side < 0 ? at : at + band, to)
    : frameBand(img, from, side < 0 ? at - band : at, to, side < 0 ? at : at + band)
  const inn = vertical
    ? frameBand(img, side < 0 ? at : at - band, from, side < 0 ? at + band : at, to)
    : frameBand(img, from, side < 0 ? at : at - band, to, side < 0 ? at + band : at)
  return out - inn
}

/** 在 [center - range, center + range] 内找边缘强度最大的位置 */
function findEdge(img: RgbImage, vertical: boolean, center: number, range: number, from: number, to: number, side: -1 | 1, band: number): number {
  let best = center
  let bestS = -2
  for (let v = center - range; v <= center + range; v += 1) {
    const s = edgeStrength(img, vertical, v, from, to, side, band)
    if (s > bestS) { bestS = s; best = v }
  }
  return best
}

/** 按左、右、下三条边框重新确定网格：格宽 = (右 - 左) / 7，顶边 = 底边 - 6 × 格宽 */
export function snapToFrame(img: RgbImage, g: Grid): Grid | null {
  const range = g.pw * 0.3
  const band = Math.max(3, g.pw * 0.08)
  const y0 = g.oy + g.ph
  const y1 = g.oy + (ROWS - 1) * g.ph
  const left = findEdge(img, true, g.ox, range, y0, y1, -1, band)
  const right = findEdge(img, true, g.ox + COLS * g.pw, range, y0, y1, 1, band)
  const p = (right - left) / COLS
  if (!(p > g.pw * 0.85 && p < g.pw * 1.15)) return null
  const bottom = findEdge(img, false, g.oy + ROWS * g.ph, range, left + p, right - p, 1, band)
  return { ox: left, oy: bottom - ROWS * p, pw: p, ph: p }
}
