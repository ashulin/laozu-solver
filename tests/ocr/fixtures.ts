/**
 * 截图识别回归测试的公共部分：读取标准答案、加载截图、按分片生成网格定位用例。
 * 每张截图定位约 2~10 秒，拆成多个测试文件让 vitest 并行跑。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GAME } from '@/core/data'
import { FRAME_MIN, fitGridAuto } from '@/core/ocr/fit'
import { recognizeGrid } from '@/core/ocr/recognize'
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
  reds: { name: string; anchor: [number, number]; awaken: number }[]
  labeled: boolean
}

export const manifest = JSON.parse(readFileSync(join(FIXTURE_DIR, 'manifest.json'), 'utf8')) as { fixtures: Fixture[] }

/** 截图用 Git LFS 管理；没装 LFS 时检出的是一小段指针文本，这类测试改为跳过 */
const LFS_POINTER = 'version https://git-lfs'
export function isLfsPointer(file: string): boolean {
  const head = readFileSync(join(FIXTURE_DIR, file)).subarray(0, LFS_POINTER.length).toString('latin1')
  return head === LFS_POINTER
}
const missing = manifest.fixtures.filter((f) => isLfsPointer(f.file)).map((f) => f.file)
export const FIXTURES_AVAILABLE = missing.length === 0
if (!FIXTURES_AVAILABLE) {
  console.warn(`[ocr] ${missing.length} 张测试截图是 Git LFS 指针，相关测试已跳过。请先安装 Git LFS 并执行 git lfs pull。`)
}

export function loadFixture(file: string): RgbImage {
  const raw = readImage(join(FIXTURE_DIR, file))
  return fromRgba(raw.width, raw.height, raw.data)
}

/** 第 shard 片（共 total 片）的网格定位用例 */
export function fitSuite(shard: number, total: number): void {
  const list = manifest.fixtures.filter((_, i) => i % total === shard)
  describe.skipIf(!FIXTURES_AVAILABLE)(`网格自动定位（真实截图 ${shard + 1}/${total}）`, () => {
    for (const f of list) {
      it(`${f.file}：定位成功，误差不超过格宽 5%`, () => {
        const img = loadFixture(f.file)
        expect([img.w, img.h]).toEqual(f.size)
        // 与生产路径一致（worker 用 fitGridAuto；部分截图只在缩放尺度上可定位）
        const fit = fitGridAuto(img)
        expect(fit.converged).toBe(true)
        expect(fit.frame).toBeGreaterThanOrEqual(FRAME_MIN)
        // 容差 5%：徽章对齐会把网格向徽章实际位置拉几像素（人工标的是格线），
        // 换来更多锚点和更准的识别；整格错位是 100%，这个容差仍然抓得住。
        const tol = f.grid.pitch * 0.05
        expect(Math.abs(fit.grid.ox - f.grid.ox), 'ox').toBeLessThan(tol)
        expect(Math.abs(fit.grid.oy - f.grid.oy), 'oy').toBeLessThan(tol)
        expect(Math.abs(fit.grid.pw - f.grid.pitch), 'pitch').toBeLessThan(tol)
        expect(fit.grid.pw).toBe(fit.grid.ph)
        const recognized = recognizeGrid(img, fit.grid)
        expect(recognized.cells).toHaveLength(42)
        for (const red of f.reds) {
          const cell = recognized.cells[red.anchor[0] * 7 + red.anchor[1]]
          expect(GAME.equipById[cell.equipId!]?.name, `${red.anchor} 自动定位后的红装`).toBe(red.name)
          expect(cell.awaken).toBe(cell.awakenDetected ? red.awaken : 0)
        }

        // 标注的空格底色应接近调色板里的「空格」色
        for (const [r, c] of f.empty) {
          const bg = cellBackground(img, fit.grid, r, c)!
          expect(Math.hypot(bg[0] - 168, bg[1] - 158, bg[2] - 149), `空格 [${r},${c}]`).toBeLessThan(30)
        }
      }, 60_000)
    }
  })
}
