import templates from '../data/raw/awaken-glyphs.json'
import { inBounds, type Grid, type RgbImage } from './sampling'

/** 仅采样火焰角标内的白色数字，不读取下方的共鸣数字。 */
export function awakenGlyph(image: RgbImage, grid: Grid, row: number, col: number): { mask: string; color: number } | null {
  const size = 48
  const white = new Uint8Array(size * size)
  let color = 0
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = Math.round(grid.ox + (col + 0.65 + x / size * 0.35) * grid.pw)
    const py = Math.round(grid.oy + (row + 0.26 + y / size * 0.43) * grid.ph)
    if (!inBounds(image, px, py)) continue
    const [r, g, b] = image.px(px, py)
    if (Math.min(r, g, b) > 185 && Math.max(r, g, b) - Math.min(r, g, b) < 48) white[y * size + x] = 1
    if (b > 110 && (g - r > 25 || b - r > 35 || b - g > 35)) color++
  }
  let best: number[] = []
  for (let i = 0; i < white.length; i++) {
    if (white[i] !== 1) continue
    const component = [i]
    white[i] = 2
    for (let j = 0; j < component.length; j++) {
      const p = component[j], x = p % size, y = Math.floor(p / size)
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (x + dx < 0 || x + dx >= size || y + dy < 0 || y + dy >= size) continue
        const n = (y + dy) * size + x + dx
        if (white[n] === 1) { white[n] = 2; component.push(n) }
      }
    }
    if (component.length > best.length) best = component
  }
  if (best.length < 25 || color < 120) return null
  const xs = best.map((p) => p % size), ys = best.map((p) => Math.floor(p / size))
  const left = Math.min(...xs), top = Math.min(...ys), width = Math.max(...xs) - left + 1, height = Math.max(...ys) - top + 1
  if (height < 12 || height > 38 || width > 39 || top < 1 || top + height >= size - 1) return null
  const pixels = new Set(best)
  let mask = ''
  for (let y = 0; y < 20; y++) for (let x = 0; x < 16; x++) {
    mask += pixels.has((top + Math.min(height - 1, Math.floor((y + 0.5) / 20 * height))) * size
      + left + Math.min(width - 1, Math.floor((x + 0.5) / 16 * width))) ? '1' : '0'
  }
  return { mask, color }
}

export function detectAwaken(image: RgbImage, grid: Grid, occupied: number[], maxLevel: number): number | null {
  const last = Math.max(...occupied)
  const glyph = awakenGlyph(image, grid, Math.floor(last / 7), last % 7)
  if (!glyph) return null
  const ranked = templates.templates.map((t) => {
    let intersection = 0, union = 0
    for (let i = 0; i < glyph.mask.length; i++) {
      if (glyph.mask[i] === '1' || t.mask[i] === '1') union++
      if (glyph.mask[i] === '1' && t.mask[i] === '1') intersection++
    }
    return { value: t.value, score: union ? intersection / union : 0 }
  }).sort((a, b) => b.score - a.score)
  const best = ranked[0]
  // IoU 绝对分随截图分辨率/抗锯齿波动（实测同款角标 0.65~0.74），靠「领先第二名」的 margin 保可靠性
  return best && best.value <= maxLevel && best.score >= 0.62 && best.score - (ranked[1]?.score ?? 0) >= 0.12 ? best.value : null
}
