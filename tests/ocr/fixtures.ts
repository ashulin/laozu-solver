/**
 * 截图识别回归测试的公共部分：读取标准答案、加载截图、按分片生成网格定位用例。
 * 每张截图定位约 2~10 秒，拆成多个测试文件让 vitest 并行跑。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FRAME_MIN, fitGrid } from '@/core/ocr/fit'
import { cellBackground, fromRgba, type RgbImage } from '@/core/ocr/sampling'
import { readImage } from '../../scripts/image-io'

export const FIXTURE_DIR = join(__dirname, '../fixtures/ocr')

export interface Fixture {
  file: string
  scene: 'ingame' | 'battle' | 'finish' | 'outgame'
  size: [number, number]
  grid: { ox: number; oy: number; pitch: number }
  elements: number[]
  empty: [number, number][]
  locked: [number, number][]
  labeled: boolean
}

export const manifest = JSON.parse(readFileSync(join(FIXTURE_DIR, 'manifest.json'), 'utf8')) as { fixtures: Fixture[] }

export function loadFixture(file: string): RgbImage {
  const raw = readImage(join(FIXTURE_DIR, file))
  return fromRgba(raw.width, raw.height, raw.data)
}

/** 第 shard 片（共 total 片）的网格定位用例 */
export function fitSuite(shard: number, total: number): void {
  const list = manifest.fixtures.filter((_, i) => i % total === shard)
  describe(`网格自动定位（真实截图 ${shard + 1}/${total}）`, () => {
    for (const f of list) {
      it(`${f.file}：定位成功，误差不超过格宽 3%`, () => {
        const img = loadFixture(f.file)
        expect([img.w, img.h]).toEqual(f.size)
        const fit = fitGrid(img)
        expect(fit.converged).toBe(true)
        expect(fit.frame).toBeGreaterThanOrEqual(FRAME_MIN)
        const tol = f.grid.pitch * 0.03
        expect(Math.abs(fit.grid.ox - f.grid.ox), 'ox').toBeLessThan(tol)
        expect(Math.abs(fit.grid.oy - f.grid.oy), 'oy').toBeLessThan(tol)
        expect(Math.abs(fit.grid.pw - f.grid.pitch), 'pitch').toBeLessThan(tol)
        expect(fit.grid.pw).toBe(fit.grid.ph)

        // 标注的空格底色应接近调色板里的「空格」色
        for (const [r, c] of f.empty) {
          const bg = cellBackground(img, fit.grid, r, c)!
          expect(Math.hypot(bg[0] - 168, bg[1] - 158, bg[2] - 149), `空格 [${r},${c}]`).toBeLessThan(30)
        }
      }, 60_000)
    }
  })
}
