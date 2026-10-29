import { describe, expect, it } from 'vitest'
import { fitGrid, fitGridAuto } from '@/core/ocr/fit'
import { recognizeGrid } from '@/core/ocr/recognize'
import { fromRgba, scaleImage } from '@/core/ocr/sampling'
import { readImage } from '../../scripts/image-io'
import { FIXTURES_AVAILABLE, loadFixture, manifest } from './fixtures'

const load = (file: string) => {
  const raw = readImage(`tests/fixtures/ocr/${file}`)
  return fromRgba(raw.width, raw.height, raw.data)
}

describe('网格定位的多尺度回退', () => {
  it('缩放不改变原图；坐标能换算回原图尺度', () => {
    const image = loadFixture(manifest.fixtures[0].file)
    const small = scaleImage(image, 0.8)
    expect(small.w).toBeLessThan(image.w)
    expect(small.h).toBeLessThan(image.h)
    // 同一像素在缩放图上的取色应来自原图对应位置
    expect(small.px(0, 0)).toEqual(image.px(0, 0))
  })

  it('原本定位失败的游历截图，缩小后能被定位', () => {
    const image = load('package-fail1.jpg')
    expect(fitGrid(image).converged).toBe(false) // 原尺度确实不行
    const fit = fitGridAuto(image)
    expect(fit.converged).toBe(true)
    expect(fit.scale).toBeLessThan(1)
    // 换算回原图坐标后可以直接识别
    const result = recognizeGrid(image, fit.grid)
    expect(result.cells.filter((c) => c.kind === 'piece').length).toBeGreaterThan(5)
  }, 60000)

  it('需要原图尺度的截图不会被缩小所误', () => {
    const image = load('package-fail2.jpg')
    const fit = fitGridAuto(image)
    expect(fit.converged).toBe(true)
    expect(fit.scale).toBe(1)
    expect(recognizeGrid(image, fit.grid).cells.filter((c) => c.kind === 'piece').length).toBeGreaterThan(5)
  }, 60000)
})

describe.skipIf(!FIXTURES_AVAILABLE)('既有截图的定位不受影响', () => {
  it('已有素材在首选尺度就收敛，不会退到兜底', () => {
    for (const fixture of manifest.fixtures.slice(0, 6)) {
      const image = loadFixture(fixture.file)
      const fit = fitGridAuto(image)
      expect(fit.converged, fixture.file).toBe(true)
      expect(fit.scale, fixture.file).toBe(1)
    }
  }, 120000)
})
