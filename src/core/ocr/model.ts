/**
 * 截图识别模型参数（来自原版 fradwow/laozu-solver 的识图管线，经觉醒版提取到 raw/ocr-data.json）。
 * 字形模板是 18×18 位图（base64），解码后做零均值、单位方差归一化，供相关系数匹配。
 */
import rawOcr from '../data/raw/ocr-data.json'

type Box = [number, number, number, number] // 相对格子的 [x0, y0, x1, y1]，0~1
type Rgb = [number, number, number]

export interface OcrGeometry {
  patchSize: number
  shifts: number[]
  elementBox: Box
  formBox: Box
  numberBox: Box
  badgeBox: Box
  moatBox: Box
  bgInset: number
  bgSpan: [number, number]
  bgStep: number
  darkLevel: number
  scanStep: number
  sigBlocks: number
  sigSamples: number
}

export interface OcrThresholds {
  anchorCandidate: number
  strictBadge: number
  strictMoat: number
  strictGap: number
  glyphCorr: number
  glyphMargin: number
  glyphCombined: number
  weakGlyphCorr: number
  weakGlyphMoat: number
  formCorr: number
  formMargin: number
  numberDisk: number
  numberAccept: number
  numberMargin: number
  bgMaxDistance: number
  fitFalloff: number
  fitConverged: number
  signatureMaxDistance: number
  signatureMinMargin: number
  signatureRescueMaxDistance: number
  signatureBlindMaxDistance: number
}

export interface OcrModel {
  version: number
  geometry: OcrGeometry
  palette: Record<'q1' | 'q2' | 'q3' | 'q4' | 'q5' | 'empty' | 'locked', Rgb>
  thresholds: OcrThresholds
  templates: { element: Record<string, string>; form: Record<string, string>; number: Record<string, string> }
}

export const MODEL = (rawOcr as unknown as { MODEL: OcrModel }).MODEL
export const GEO = MODEL.geometry
export const TH = MODEL.thresholds
export const PALETTE: Rgb[] = Object.values(MODEL.palette)

/** 零均值、单位方差归一化（全等值时方差按 1 处理） */
export function normalize(v: ArrayLike<number>): Float64Array {
  const n = v.length
  let mean = 0
  for (let i = 0; i < n; i++) mean += v[i]
  mean /= n
  let sd = 0
  for (let i = 0; i < n; i++) sd += (v[i] - mean) ** 2
  sd = Math.sqrt(sd / n) || 1
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = (v[i] - mean) / sd
  return out
}

/** base64 位图 → 归一化模板（位为 1 记 +1，否则 -1） */
export function decodeTemplate(b64: string, patchSize = GEO.patchSize): Float64Array {
  const bytes = atob(b64)
  const n = patchSize * patchSize
  const v = new Float64Array(n)
  for (let i = 0; i < n; i++) v[i] = (bytes.charCodeAt(i >> 3) >> (i & 7)) & 1 ? 1 : -1
  return normalize(v)
}

const decodeAll = (m: Record<string, string>) => new Map(Object.entries(m).map(([k, v]) => [k, decodeTemplate(v)]))

/** 元素徽章字形：金木水火土雷邪体 */
export const ELEMENT_GLYPHS = decodeAll(MODEL.templates.element)

/** 形态徽章字形：剑乐异御枪刀锤幡 */
export const FORM_GLYPHS = decodeAll(MODEL.templates.form)

/** 形态字到 FORM_NAME 编号的映射 */
export const FORM_ID: Record<string, number> = Object.fromEntries(
  Object.entries({ 剑: 2, 乐: 3, 异: 4, 御: 5, 枪: 6, 刀: 7, 锤: 8, 幡: 9 }),
)
/** 右下角数字字形 */
export const NUMBER_GLYPHS = decodeAll(MODEL.templates.number)
