/**
 * 旧版识图机制（原版/觉醒版的 48 维颜色签名）。
 *
 * 它与我们自己的逐点采样是两条独立通道：特征不同、库来源不同（游戏截图 vs 原生大图）。
 * 实测两者在难点上分歧很大，因此这里**只用来补充候选**——
 * 当我们匹配不出可靠结果时给出可选项，绝不参与自动确认。
 */
import { GAME } from '../data'
import legacy from '../data/raw/legacy-signatures.json'
import type { Candidate } from './recognize'
import { inBounds, type Grid, type RgbImage } from './sampling'

const BLOCKS = 4
const SAMPLES = 10

/** 4×4 分块平均 RGB：与原版 us 一致（只取锚点那一格） */
export function cellSignature(img: RgbImage, grid: Grid, row: number, col: number): number[] {
  const out = new Array(BLOCKS * BLOCKS * 3).fill(0)
  let o = 0
  for (let by = 0; by < BLOCKS; by++) for (let bx = 0; bx < BLOCKS; bx++) {
    let sr = 0, sg = 0, sb = 0, k = 0
    for (let j = 0; j < SAMPLES; j++) for (let i = 0; i < SAMPLES; i++) {
      const x = Math.round(grid.ox + col * grid.pw + (bx + (i + 0.5) / SAMPLES) / BLOCKS * grid.pw)
      const y = Math.round(grid.oy + row * grid.ph + (by + (j + 0.5) / SAMPLES) / BLOCKS * grid.ph)
      if (!inBounds(img, x, y)) continue
      const v = img.px(x, y)
      sr += v[0]; sg += v[1]; sb += v[2]; k++
    }
    out[o++] = k ? sr / k : 0
    out[o++] = k ? sg / k : 0
    out[o++] = k ? sb / k : 0
  }
  return out
}

/** 平均绝对差（与原版 sigDist 一致） */
export function signatureDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

/** 距离上限放宽：这里只提供候选供人工挑选，宁可多给几项也不要空手 */
export const LEGACY_MAX_DISTANCE = 30

/**
 * 旧版候选：按签名距离排序，可选按元素收窄。
 * 返回的候选只供人工选择，调用方不要据此确认。
 */
export function legacyCandidates(img: RgbImage, grid: Grid, row: number, col: number, element: number | null, limit = 5): Candidate[] {
  const sig = cellSignature(img, grid, row, col)
  const ranked: Candidate[] = []
  for (const template of legacy.templates) {
    const eq = GAME.equipById[template.id]
    if (!eq) continue
    if (element && eq.element !== element) continue
    const distance = signatureDistance(template.sig, sig)
    if (distance > LEGACY_MAX_DISTANCE) continue
    ranked.push({ equipId: template.id, distance: Math.round(distance * 100) / 100 })
  }
  return ranked.sort((a, b) => a.distance - b.distance).slice(0, limit)
}
