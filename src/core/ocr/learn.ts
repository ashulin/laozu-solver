/**
 * 从用户纠正中学习：把「用户确认过的这一格长什么样」记下来，下次同类截图直接用它比对。
 *
 * 与内置模板同构（同一套稀疏采样点坐标，颜色来自真实截图），
 * 因此可以直接用 matchArt 比较，也能区分同名不同阶——样本绑定的是具体 equipId。
 */
import { GAME } from '../data'
import library from '../data/raw/ocr-library.json'
import { inBounds, type Grid, type RgbImage } from './sampling'

export interface OcrSample {
  equipId: number
  points: number[]
  createdAt: string
}

export interface OcrSamplesData {
  samples: OcrSample[]
}

/** 总量与单件上限：样本是逐点颜色，体积不小，必须有界（300 条约 0.5 MB，仍在备份体积内） */
export const MAX_SAMPLES = 300
export const MAX_SAMPLES_PER_EQUIP = 2
/** 与已有样本几乎一致时不再重复保存 */
export const SAMPLE_DEDUPE_DISTANCE = 6

const templateOf = (equipId: number) => library.templates.find((t) => t.id === equipId)

/** 形状首个占格：锚点格相对形状原点的偏移 */
function shapeOrigin(equipId: number): { r0: number; c0: number } | null {
  const eq = GAME.equipById[equipId]
  if (!eq) return null
  const shape = GAME.shapeById[eq.shapeId]
  const first = [...shape.cells].sort((a, b) => a[0] - b[0] || a[1] - b[1])[0]
  return { r0: -first[0], c0: -first[1] }
}

/**
 * 从截图的这一格提取样本：沿用内置模板的采样点坐标，只把颜色换成截图里的实际像素。
 * 坐标一致才能与内置模板逐点比较。
 */
export function extractSample(img: RgbImage, grid: Grid, row: number, col: number, equipId: number, at = new Date()): OcrSample | null {
  const template = templateOf(equipId)
  const origin = shapeOrigin(equipId)
  if (!template || !origin) return null
  const points: number[] = []
  for (let i = 0; i < template.points.length; i += 5) {
    const fx = template.points[i] / 1000, fy = template.points[i + 1] / 1000
    const cx = Math.round(grid.ox + (col + origin.c0 + fx) * grid.pw)
    const cy = Math.round(grid.oy + (row + origin.r0 + fy) * grid.ph)
    let r = 0, g = 0, b = 0, n = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!inBounds(img, cx + dx, cy + dy)) continue
      const p = img.px(cx + dx, cy + dy)
      r += p[0]; g += p[1]; b += p[2]; n++
    }
    if (!n) continue
    points.push(template.points[i], template.points[i + 1], Math.round(r / n), Math.round(g / n), Math.round(b / n))
  }
  if (points.length < 50) return null
  return { equipId, points, createdAt: at.toISOString() }
}

/** 样本与内置模板的逐点平均色差：过大说明这一格被特效/遮挡影响，学习价值低 */
export function sampleDrift(sample: OcrSample): number {
  const template = templateOf(sample.equipId)
  if (!template || template.points.length !== sample.points.length) return Number.POSITIVE_INFINITY
  let error = 0, count = 0
  for (let i = 0; i < sample.points.length; i += 5) {
    error += (Math.abs(sample.points[i + 2] - template.points[i + 2])
      + Math.abs(sample.points[i + 3] - template.points[i + 3])
      + Math.abs(sample.points[i + 4] - template.points[i + 4])) / 3
    count++
  }
  return count ? error / count : Number.POSITIVE_INFINITY
}

/** 两个样本的逐点平均色差，用于去重 */
export function sampleDistance(a: OcrSample, b: OcrSample): number {
  if (a.equipId !== b.equipId || a.points.length !== b.points.length) return Number.POSITIVE_INFINITY
  let error = 0, count = 0
  for (let i = 0; i < a.points.length; i += 5) {
    error += (Math.abs(a.points[i + 2] - b.points[i + 2])
      + Math.abs(a.points[i + 3] - b.points[i + 3])
      + Math.abs(a.points[i + 4] - b.points[i + 4])) / 3
    count++
  }
  return count ? error / count : Number.POSITIVE_INFINITY
}

export interface MergeResult { samples: OcrSample[]; added: boolean; replaced: boolean }

/**
 * 合并一条新样本：同一件最多保留 2 份（替换最旧），总量超限丢最旧。
 * 与已有样本几乎一致时视为重复，不写入。
 */
export function mergeSample(current: OcrSample[], sample: OcrSample): MergeResult {
  const sameEquip = current.filter((s) => s.equipId === sample.equipId)
  if (sameEquip.some((s) => sampleDistance(s, sample) < SAMPLE_DEDUPE_DISTANCE)) {
    return { samples: current, added: false, replaced: false }
  }
  let next = current
  if (sameEquip.length >= MAX_SAMPLES_PER_EQUIP) {
    const oldest = sameEquip.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b))
    next = next.filter((s) => s !== oldest)
  }
  next = [...next, sample]
  if (next.length > MAX_SAMPLES) {
    const oldest = next.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b))
    next = next.filter((s) => s !== oldest)
  }
  return { samples: next, added: true, replaced: sameEquip.length >= MAX_SAMPLES_PER_EQUIP }
}

/** 样本点坐标必须与内置模板一致，否则无法逐点比较 */
export function isValidSample(sample: unknown): sample is OcrSample {
  if (!sample || typeof sample !== 'object') return false
  const s = sample as Record<string, unknown>
  if (typeof s.equipId !== 'number' || !GAME.equipById[s.equipId]) return false
  if (!Array.isArray(s.points) || s.points.length % 5 !== 0) return false
  const template = templateOf(s.equipId)
  if (!template || template.points.length !== s.points.length) return false
  return s.points.every((v) => typeof v === 'number' && Number.isFinite(v))
}
