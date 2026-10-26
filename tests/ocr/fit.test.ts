import { describe, expect, it } from 'vitest'
import { decodeTemplate, ELEMENT_GLYPHS, FORM_GLYPHS, NUMBER_GLYPHS } from '@/core/ocr/model'
import { fitSuite, manifest } from './fixtures'

describe('识图模型', () => {
  it('字形模板齐全且已归一化', () => {
    expect([...ELEMENT_GLYPHS.keys()]).toEqual(['金', '木', '水', '火', '土', '雷', '邪', '体'])
    expect([...FORM_GLYPHS.keys()]).toEqual(['剑', '乐', '异', '御', '枪', '刀', '锤', '幡'])
    expect(NUMBER_GLYPHS.size).toBeGreaterThan(10)
    const t = decodeTemplate('AwIEHAB4APAD4Hzg4cf/H/snBAPA/wH/B9gOYBuAbcD/D/8/AQAAAAA=')
    const mean = t.reduce((a, b) => a + b, 0) / t.length
    const varc = t.reduce((a, b) => a + b * b, 0) / t.length
    expect(Math.abs(mean)).toBeLessThan(1e-9)
    expect(varc).toBeCloseTo(1, 6)
  })
})

describe('测试素材', () => {
  it('覆盖游历中（地图/对决）、刚结束游历、游历完成四种画面，以及双元素背包', () => {
    const scenes = new Set(manifest.fixtures.map((f) => f.scene))
    for (const s of ['ingame', 'battle', 'finish', 'outgame']) expect(scenes.has(s as never), s).toBe(true)
    expect(manifest.fixtures.some((f) => f.elements.length === 2)).toBe(true)
  })

  it('文件名唯一，网格都已人工核对', () => {
    expect(new Set(manifest.fixtures.map((f) => f.file)).size).toBe(manifest.fixtures.length)
    expect(manifest.fixtures.every((f) => (f.grid as { verified?: boolean }).verified)).toBe(true)
  })
})

fitSuite(0, 3)
