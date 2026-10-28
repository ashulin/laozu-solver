import { describe, expect, it } from 'vitest'
import { GAME } from '@/core/data'
import legacy from '@/core/data/raw/legacy-signatures.json'
import { LEGACY_MAX_DISTANCE, cellSignature, legacyCandidates, signatureDistance } from '@/core/ocr/legacy'
import { recognizeGrid } from '@/core/ocr/recognize'
import type { Grid } from '@/core/ocr/sampling'
import { FIXTURES_AVAILABLE, loadFixture, manifest } from './fixtures'

describe('旧版识图（48 维签名）', () => {
  it('签名库是内置数据的子集，字段完整', () => {
    expect(legacy.templates.length).toBe(192)
    for (const t of legacy.templates) {
      expect(GAME.equipById[t.id], `${t.id}`).toBeTruthy()
      expect(t.sig).toHaveLength(48)
      expect(t.sig.every((v) => Number.isFinite(v))).toBe(true)
    }
  })

  it('签名距离：完全相同为 0，逐项差值的平均值', () => {
    const a = [0, 10, 20, 30]
    expect(signatureDistance(a, a)).toBe(0)
    expect(signatureDistance(a, [4, 14, 24, 34])).toBe(4)
  })

  it('候选按距离升序，受元素与距离上限约束', () => {
    const fixture = manifest.fixtures[0]
    const image = loadFixture(fixture.file)
    const g: Grid = { ox: fixture.grid.ox, oy: fixture.grid.oy, pw: fixture.grid.pitch, ph: fixture.grid.pitch }
    const sig = cellSignature(image, g, 0, 0)
    expect(sig).toHaveLength(48)
    const all = legacyCandidates(image, g, 0, 0, null)
    for (const c of all) expect(c.distance).toBeLessThanOrEqual(LEGACY_MAX_DISTANCE)
    for (let i = 1; i < all.length; i++) expect(all[i - 1].distance).toBeLessThanOrEqual(all[i].distance)
    expect(all.length).toBeLessThanOrEqual(5)
    // 元素过滤只会更窄
    const narrowed = legacyCandidates(image, g, 0, 0, 1)
    expect(narrowed.length).toBeLessThanOrEqual(all.length)
    for (const c of narrowed) expect(GAME.equipById[c.equipId].element).toBe(1)
  })
})

describe.skipIf(!FIXTURES_AVAILABLE)('旧版只补充候选，不参与确认', () => {
  it('我们匹配不出的格子仍保持未知，只是多出可选项', () => {
    let unknowns = 0, withCandidates = 0
    // 这 3 张各含若干我们匹配不出的格子
    const subset = manifest.fixtures.filter((f) => ['outgame-water-01.jpg', 'battle-metal-01.jpg', 'ingame-metal-01.jpg'].includes(f.file))
    expect(subset).toHaveLength(3)
    for (const fixture of subset) {
      const image = loadFixture(fixture.file)
      const g: Grid = { ox: fixture.grid.ox, oy: fixture.grid.oy, pw: fixture.grid.pitch, ph: fixture.grid.pitch }
      for (const cell of recognizeGrid(image, g).cells) {
        if (cell.kind !== 'unknown') continue
        unknowns++
        // 关键：旧版不会替我们定答案
        expect(cell.equipId).toBeNull()
        expect(cell.confirmed).toBe(false)
        if (cell.candidates.length) withCandidates++
      }
    }
    expect(unknowns).toBeGreaterThan(0)
    expect(withCandidates).toBeGreaterThan(0)
  }, 60000)

  it('已识别的法宝不会因为旧版候选而改变答案', () => {
    const fixture = manifest.fixtures.find((f) => f.file === 'outgame-earth-04.jpg')!
    const image = loadFixture(fixture.file)
    const g: Grid = { ox: fixture.grid.ox, oy: fixture.grid.oy, pw: fixture.grid.pitch, ph: fixture.grid.pitch }
    const withLegacy = recognizeGrid(image, g)
    const picks = withLegacy.cells.filter((c) => c.kind === 'piece').map((c) => `${c.row},${c.col}:${c.equipId}`)
    expect(picks.length).toBeGreaterThan(5)
    // 候选里允许出现旧版补充项，但首选仍是自己的结果
    for (const c of withLegacy.cells) {
      if (c.kind !== 'piece' || !c.candidates.length) continue
      expect(c.candidates[0].equipId).toBe(c.equipId)
    }
  })
})
