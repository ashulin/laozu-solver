/**
 * 像素采样基元（移植自原版识图管线）。全部以「格子相对坐标」采样，格子由 Grid 决定。
 * 输入图像用 RgbImage 抽象：浏览器里来自 canvas ImageData，测试里来自 JPEG 解码。
 */
import { GEO, PALETTE, normalize } from './model'

export type Rgb = [number, number, number]

export interface RgbImage {
  w: number
  h: number
  px(x: number, y: number): Rgb
}

/** 6×7 网格定位：左上角 (ox, oy)，格宽 pw、格高 ph（像素） */
export interface Grid {
  ox: number
  oy: number
  pw: number
  ph: number
}

/** RGBA 字节数组（ImageData 同构）→ RgbImage */
export function fromRgba(width: number, height: number, data: ArrayLike<number>): RgbImage {
  return {
    w: width,
    h: height,
    px: (x, y) => {
      const i = (y * width + x) * 4
      return [data[i], data[i + 1], data[i + 2]]
    },
  }
}

/** 按 factor×factor 块取平均缩小（粗搜网格用） */
/** 等比缩放（最近邻），用于按不同尺度定位网格 */
export function scaleImage(img: RgbImage, scale: number): RgbImage {
  if (scale >= 1) return img
  const w = Math.max(1, Math.round(img.w * scale))
  const h = Math.max(1, Math.round(img.h * scale))
  return {
    w,
    h,
    px: (x: number, y: number) => img.px(
      Math.min(img.w - 1, Math.round(x / scale)),
      Math.min(img.h - 1, Math.round(y / scale)),
    ),
  }
}

export function downsample(img: RgbImage, factor: number): RgbImage {
  if (factor <= 1) return img
  const w = Math.floor(img.w / factor)
  const h = Math.floor(img.h / factor)
  const buf = new Float64Array(w * h * 3)
  const area = factor * factor
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const p = img.px(x * factor + dx, y * factor + dy)
          r += p[0]; g += p[1]; b += p[2]
        }
      }
      const i = (y * w + x) * 3
      buf[i] = r / area; buf[i + 1] = g / area; buf[i + 2] = b / area
    }
  }
  return { w, h, px: (x, y) => { const i = (y * w + x) * 3; return [buf[i], buf[i + 1], buf[i + 2]] } }
}

export const inBounds = (img: RgbImage, x: number, y: number) => x >= 0 && y >= 0 && x < img.w && y < img.h
export const colorDistance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

const bufR = new Float64Array(512)
const bufG = new Float64Array(512)
const bufB = new Float64Array(512)

/** 原地插入排序后取中位数（n 很小，避免分配） */
function median(a: Float64Array, n: number): number {
  for (let i = 1; i < n; i++) {
    const v = a[i]
    let j = i - 1
    while (j >= 0 && a[j] > v) { a[j + 1] = a[j]; j-- }
    a[j + 1] = v
  }
  return a[n >> 1]
}

/**
 * 格子底色：沿格子四条边内缩 bgInset 处、在 bgSpan 区间内等距采样，取各通道中位数。
 * 避开四角（徽章、数字所在）和中央（法宝图案）。格子完全在图外时返回 null。
 */
export function cellBackground(img: RgbImage, grid: Grid, row: number, col: number, step = GEO.bgStep): Rgb | null {
  let n = 0
  const x0 = grid.ox + col * grid.pw
  const y0 = grid.oy + row * grid.ph
  const ix = grid.pw * GEO.bgInset
  const iy = grid.ph * GEO.bgInset
  const take = (fx: number, fy: number) => {
    const x = Math.round(fx)
    const y = Math.round(fy)
    if (!inBounds(img, x, y) || n >= 512) return
    const p = img.px(x, y)
    bufR[n] = p[0]; bufG[n] = p[1]; bufB[n] = p[2]; n++
  }
  const [from, to] = GEO.bgSpan
  for (let t = from; t < to; t += step) {
    take(x0 + grid.pw * t, y0 + iy)
    take(x0 + grid.pw * t, y0 + grid.ph - iy)
    take(x0 + ix, y0 + grid.ph * t)
    take(x0 + grid.pw - ix, y0 + grid.ph * t)
  }
  return n ? [median(bufR, n), median(bufG, n), median(bufB, n)] : null
}

/** 与调色板（五种品质底色 + 空格 + 锁格）的最近距离 */
export function paletteDistance(c: Rgb): number {
  let best = Number.POSITIVE_INFINITY
  for (const p of PALETTE) best = Math.min(best, colorDistance(c, p))
  return best
}

/** 格内某区域的暗像素比例（徽章是深色圆底，用来找锚点格） */
export function darkRatio(img: RgbImage, grid: Grid, row: number, col: number, box: readonly number[]): number {
  let total = 0
  let dark = 0
  for (let fy = box[1]; fy < box[3]; fy += GEO.scanStep) {
    for (let fx = box[0]; fx < box[2]; fx += GEO.scanStep) {
      const x = Math.round(grid.ox + col * grid.pw + fx * grid.pw)
      const y = Math.round(grid.oy + row * grid.ph + fy * grid.ph)
      if (!inBounds(img, x, y)) continue
      const p = img.px(x, y)
      total++
      if ((p[0] + p[1] + p[2]) / 3 < GEO.darkLevel) dark++
    }
  }
  return total ? dark / total : 0
}

/** 把格内 box 区域重采样成 patchSize² 的灰度块并归一化；(dx, dy) 为相对格宽的微小平移 */
export function samplePatch(img: RgbImage, grid: Grid, row: number, col: number, box: readonly number[], dx = 0, dy = 0): Float64Array {
  const s = GEO.patchSize
  const v = new Float64Array(s * s)
  for (let j = 0; j < s; j++) {
    for (let i = 0; i < s; i++) {
      const fx = box[0] + ((i + 0.5) / s) * (box[2] - box[0]) + dx
      const fy = box[1] + ((j + 0.5) / s) * (box[3] - box[1]) + dy
      const x = Math.round(grid.ox + col * grid.pw + fx * grid.pw)
      const y = Math.round(grid.oy + row * grid.ph + fy * grid.ph)
      const p = inBounds(img, x, y) ? img.px(x, y) : [128, 128, 128]
      v[j * s + i] = (p[0] + p[1] + p[2]) / 3
    }
  }
  return normalize(v)
}

/** 两个归一化向量的相关系数（-1~1） */
export function correlation(a: Float64Array, b: Float64Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s / a.length
}

/**
 * 轻度高斯平滑（3x3，σ≈0.5）。
 * 识别模板提取自压缩截图；锐利的原图（高质量导出）高频细节会让相关分数下降，
 * 实测同一背包「原图比压缩图多 3 个未知格、3 个阶误判」。平滑把所有输入归一到
 * 与模板来源一致的频率特性，实测对已压缩截图近似无损、对原图显著改善。
 */
export function gaussianSmooth(img: RgbImage): RgbImage {
  const { w, h } = img
  const src = new Float64Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = img.px(x, y)
      const o = (y * w + x) * 3
      src[o] = r
      src[o + 1] = g
      src[o + 2] = b
    }
  }
  const tmp = new Float64Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3
      const l = (y * w + Math.max(0, x - 1)) * 3
      const m = o
      const r = (y * w + Math.min(w - 1, x + 1)) * 3
      for (let ch = 0; ch < 3; ch++) tmp[o + ch] = (src[l + ch] + 2 * src[m + ch] + src[r + ch]) / 4
    }
  }
  const data = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3
      const u = (Math.max(0, y - 1) * w + x) * 3
      const m = o
      const d = (Math.min(h - 1, y + 1) * w + x) * 3
      for (let ch = 0; ch < 3; ch++) data[o + ch] = Math.round((tmp[u + ch] + 2 * tmp[m + ch] + tmp[d + ch]) / 4)
    }
  }
  return { w, h, px: (x, y) => {
    const o = (y * w + x) * 3
    return [data[o], data[o + 1], data[o + 2]]
  } }
}

/** 共鸣圆章内白色笔画判据（与 build-number-samples.ts 保持一致） */
const WHITE_MIN = 150
const WHITE_SAT = 60

/**
 * numberBox 区域的「白色覆盖率」采样：数字笔画为高值，圆章底色与品阶/元素染色一律为低值。
 * 相比灰度采样，它消除了不同品阶、元素圆章染色带来的差异，可与真实圆章样本直接比较。
 * 每个子格在 3x3 像素窗内取白色占比（面积平均，保留抗锯齿边缘的梯度）。
 */
export function sampleWhitePatch(img: RgbImage, grid: Grid, row: number, col: number, dx = 0, dy = 0): Float64Array | null {
  const s = GEO.patchSize
  const box = GEO.numberBox
  const step = (box[2] - box[0]) * grid.pw / s
  const v = new Float64Array(s * s)
  let covered = 0
  for (let j = 0; j < s; j++) {
    for (let i = 0; i < s; i++) {
      const cx = Math.round(grid.ox + (col + box[0]) * grid.pw + (i + 0.5) * step + dx * grid.pw)
      const cy = Math.round(grid.oy + (row + box[1]) * grid.ph + (j + 0.5) * step + dy * grid.ph)
      let hit = 0
      let total = 0
      for (let wy = -1; wy <= 1; wy++) for (let wx = -1; wx <= 1; wx++) {
        const x = cx + wx
        const y = cy + wy
        if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue
        total++
        const [r, g, b] = img.px(x, y)
        if (Math.min(r, g, b) > WHITE_MIN && Math.max(r, g, b) - Math.min(r, g, b) < WHITE_SAT) hit++
      }
      const p = total ? hit / total : 0
      v[j * s + i] = p
      covered += p
    }
  }
  if (covered / v.length < 0.05) return null // 区域内没有数字笔画
  return normalize(v)
}

/** 在一组微小平移下取与模板的最大相关系数（容忍网格几像素误差） */
export function bestCorrelation(
  img: RgbImage, grid: Grid, row: number, col: number, box: readonly number[], template: Float64Array, shifts: readonly number[] = GEO.shifts,
): number {
  let best = -2
  for (const dx of shifts) {
    for (const dy of shifts) {
      const c = correlation(samplePatch(img, grid, row, col, box, dx, dy), template)
      if (c > best) best = c
    }
  }
  return best
}
