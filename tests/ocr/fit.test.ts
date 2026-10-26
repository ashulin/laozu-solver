/**
 * 截图识别回归测试：用 tests/fixtures/ocr 下的真实截图校验网格自动定位。
 * 标准答案见 manifest.json（网格位置已用叠加图人工核对）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { fitGrid } from '@/core/ocr/fit'
import { decodeTemplate, ELEMENT_GLYPHS, FORM_GLYPHS, NUMBER_GLYPHS } from '@/core/ocr/model'
import { cellBackground, fromRgba, type RgbImage } from '@/core/ocr/sampling'

const DIR = join(__dirname, '../fixtures/ocr')
interface Fixture {
  file: string
  scene: 'ingame' | 'outgame'
  size: [number, number]
  grid: { ox: number; oy: number; pitch: number }
  empty: [number, number][]
}
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as { fixtures: Fixture[] }

const load = (file: string): RgbImage => {
  const raw = jpeg.decode(readFileSync(join(DIR, file)), { useTArray: true, maxMemoryUsageInMB: 1024 })
  return fromRgba(raw.width, raw.height, raw.data)
}

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

describe('网格自动定位（真实截图）', () => {
  it('局内、局外两种场景都有样本', () => {
    expect(new Set(manifest.fixtures.map((f) => f.scene))).toEqual(new Set(['ingame', 'outgame']))
  })

  for (const f of manifest.fixtures) {
    it(`${f.file}：定位成功，误差不超过格宽 3%`, () => {
      const img = load(f.file)
      expect([img.w, img.h]).toEqual(f.size)
      const fit = fitGrid(img)
      expect(fit.converged).toBe(true)
      const tol = f.grid.pitch * 0.03
      expect(Math.abs(fit.grid.ox - f.grid.ox)).toBeLessThan(tol)
      expect(Math.abs(fit.grid.oy - f.grid.oy)).toBeLessThan(tol)
      expect(Math.abs(fit.grid.pw - f.grid.pitch)).toBeLessThan(tol)
      expect(fit.grid.pw).toBe(fit.grid.ph)

      // 标注的空格底色应接近调色板里的「空格」色
      for (const [r, c] of f.empty) {
        const bg = cellBackground(img, fit.grid, r, c)!
        expect(Math.hypot(bg[0] - 168, bg[1] - 158, bg[2] - 149), `空格 [${r},${c}]`).toBeLessThan(30)
      }
    }, 30_000)
  }
})
