import { describe, expect, it } from 'vitest'
import { GAME } from '@/core/data'
import library from '@/core/data/raw/ocr-library.json'
import type { RgbImage } from '@/core/ocr/sampling'
import { recognizeGrid } from '@/core/ocr/recognize'
import {
  MAX_SAMPLES, MAX_SAMPLES_PER_EQUIP, SAMPLE_DEDUPE_DISTANCE,
  extractSample, isValidSample, mergeSample, sampleDistance, sampleDrift, type OcrSample,
} from '@/core/ocr/learn'
import { validateOcrSamples } from '@/services/persist-schema'
import { FIXTURES_AVAILABLE, loadFixture, manifest } from './fixtures'

const grid = { ox: 0, oy: 0, pw: 100, ph: 100 }

/** 用内置模板自身的颜色伪造一张"截图"：这样提取出的样本应当与模板一致 */
function fakeShot(equipId: number): RgbImage {
  const template = library.templates.find((t) => t.id === equipId)!
  const pts: { x: number; y: number; c: [number, number, number] }[] = []
  for (let i = 0; i < template.points.length; i += 5) {
    pts.push({
      x: template.points[i] / 1000 * grid.pw,
      y: template.points[i + 1] / 1000 * grid.ph,
      c: [template.points[i + 2], template.points[i + 3], template.points[i + 4]],
    })
  }
  return {
    w: 700, h: 600,
    px: (x: number, y: number) => {
      let best = pts[0], bestD = Infinity
      for (const p of pts) {
        const d = (p.x - x) ** 2 + (p.y - y) ** 2
        if (d < bestD) { bestD = d; best = p }
      }
      return best.c
    },
  }
}

/** 单格且形状原点就在首格的装备，便于逐点比对 */
const single = GAME.equips.find((e) => {
  const shape = GAME.shapeById[e.shapeId]
  return shape.cellCount === 1 && shape.cells[0][0] === 0 && shape.cells[0][1] === 0 && library.templates.some((t) => t.id === e.id)
})!

describe('识图学习样本', () => {
  it('提取的样本与内置模板同构：点数与坐标完全一致，颜色来自截图', () => {
    const id = single.id
    const template = library.templates.find((t) => t.id === id)!
    const sample = extractSample(fakeShot(id), grid, 0, 0, id)!
    expect(sample).not.toBeNull()
    expect(sample.points.length).toBe(template.points.length)
    for (let i = 0; i < sample.points.length; i += 5) {
      expect(sample.points[i]).toBe(template.points[i])
      expect(sample.points[i + 1]).toBe(template.points[i + 1])
    }
    expect(sampleDrift(sample)).toBeLessThan(1)
    expect(isValidSample(sample)).toBe(true)
  })

  it('未知道具、取不到图案时不产生样本', () => {
    const blank: RgbImage = { w: 700, h: 600, px: () => [0, 0, 0] }
    expect(extractSample(blank, grid, 0, 0, 999999)).toBeNull()
    // 超出图片边界的格子也能安全返回 null，而不是抛错
    expect(() => extractSample(blank, grid, 41, 41, GAME.equips[0].id)).not.toThrow()
  })

  it('合并：重复样子不写入；同件超过 2 份替换最旧；总量封顶', () => {
    const id = GAME.equips[0].id
    const base: OcrSample = { equipId: id, points: [0, 0, 10, 10, 10], createdAt: '2024-01-01T00:00:00.000Z' }
    const newer: OcrSample = { equipId: id, points: [0, 0, 200, 200, 200], createdAt: '2024-06-01T00:00:00.000Z' }
    expect(mergeSample([base], { ...base }).added).toBe(false)
    expect(sampleDistance(base, newer)).toBeGreaterThan(SAMPLE_DEDUPE_DISTANCE)

    let list = mergeSample([], base).samples
    list = mergeSample(list, newer).samples
    expect(list).toHaveLength(2)
    const third = mergeSample(list, { equipId: id, points: [0, 0, 30, 30, 30], createdAt: '2024-07-01T00:00:00.000Z' })
    expect(third.replaced).toBe(true)
    expect(third.samples).toHaveLength(2)
    expect(third.samples.map((s) => s.createdAt)).not.toContain(base.createdAt)

    let many: OcrSample[] = []
    for (let i = 0; i < MAX_SAMPLES + 5; i++) {
      many = mergeSample(many, { equipId: GAME.equips[i % GAME.equips.length].id, points: [0, 0, i % 255, 0, 0], createdAt: new Date(Date.UTC(2024, 0, i + 1)).toISOString() }).samples
    }
    expect(many.length).toBeLessThanOrEqual(MAX_SAMPLES)
    expect(many.length).toBe(MAX_SAMPLES)
  })

  it('存储校验：点数与内置不一致、装备不存在、非数组都会被丢弃', () => {
    const id = library.templates[0].id
    const template = library.templates.find((t) => t.id === id)!
    const good: OcrSample = { equipId: id, points: template.points.map((v) => v), createdAt: '2024-01-01T00:00:00.000Z' }
    const validated = validateOcrSamples({ samples: [good, { equipId: 1, points: [1, 2, 3] }, { equipId: id, points: [1, 2, 3, 4, 5] }, null, { equipId: id, points: template.points }] }, GAME)
    expect(validated.samples).toHaveLength(2)
    expect(validated.samples[0].points).toEqual(good.points)
    expect(validated.samples[1].createdAt).toBe('')
    expect(() => validateOcrSamples('x', GAME)).toThrow()
    // 每件最多 2 条
    const three = [good, { ...good }, { ...good }]
    expect(validateOcrSamples({ samples: three }, GAME).samples).toHaveLength(MAX_SAMPLES_PER_EQUIP)
  })
})

describe.skipIf(!FIXTURES_AVAILABLE)('学习样本参与真实截图识别', () => {
  it('教过之后，原本待核对的格子可以被直接采信', () => {
    const fixture = manifest.fixtures.find((f) => f.file === 'outgame-wood-water-01.jpg')!
    const image = loadFixture(fixture.file)
    const g = { ox: fixture.grid.ox, oy: fixture.grid.oy, pw: fixture.grid.pitch, ph: fixture.grid.pitch }
    const before = recognizeGrid(image, g)
    // 找一个原本待核对的法宝格
    const index = before.cells.findIndex((c) => c.kind === 'piece' && c.equipId && !c.confirmed)
    expect(index).toBeGreaterThanOrEqual(0)
    const cell = before.cells[index]
    const sample = extractSample(image, g, cell.row, cell.col, cell.equipId!)!
    expect(sample).not.toBeNull()
    const after = recognizeGrid(image, g, [sample])
    const updated = after.cells[index]
    expect(updated.equipId).toBe(cell.equipId)
    expect(updated.confirmed).toBe(true)
    expect(updated.reason).toContain('教过')
  })
})
