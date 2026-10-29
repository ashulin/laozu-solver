import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { alignByBadges, countAnchors, fitGridAuto, MIN_ANCHORS } from '@/core/ocr/fit'
import { decodeTemplate, ELEMENT_GLYPHS, FORM_GLYPHS, NUMBER_GLYPHS } from '@/core/ocr/model'
import { FIXTURES_AVAILABLE, FIXTURE_DIR, fitSuite, isLfsPointer, loadFixture, manifest } from './fixtures'

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

describe.skipIf(!FIXTURES_AVAILABLE)('网格对齐', () => {
  it('漂移十几像素的网格能被徽章对齐拉回，锚点复原', () => {
    const truth = manifest.fixtures[0].grid
    const img = loadFixture(manifest.fixtures[0].file)
    const drifted = { ox: truth.ox + 12, oy: truth.oy - 10, pw: truth.pitch * 1.03, ph: truth.pitch * 1.03 }
    const before = countAnchors(img, drifted)
    const aligned = alignByBadges(img, drifted)
    expect(aligned, '漂移后应能对齐').not.toBeNull()
    expect(countAnchors(img, aligned!)).toBeGreaterThan(before)
    expect(Math.abs(aligned!.ox - truth.ox), 'ox').toBeLessThan(truth.pitch * 0.05)
    expect(Math.abs(aligned!.oy - truth.oy), 'oy').toBeLessThan(truth.pitch * 0.05)
  })

  // 浏览器 canvas 与 Node jpeg-js 解码同一张 JPEG 会有几级色差，这张图曾因此锚点全灭、被判定位失败
  const CLIP = 'package-fail2.jpg'
  it.skipIf(!existsSync(join(FIXTURE_DIR, CLIP)) || isLfsPointer(CLIP))('裁掉上方的游历截图也能定位成功', () => {
    const img = loadFixture(CLIP)
    expect(img.h).toBeGreaterThan(img.w)
    const fit = fitGridAuto(img)
    expect(fit.converged).toBe(true)
    expect(fit.anchors).toBeGreaterThanOrEqual(MIN_ANCHORS)
  }, 120_000)
})

fitSuite(0, 3)
