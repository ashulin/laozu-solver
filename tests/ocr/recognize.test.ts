import { describe, expect, it } from 'vitest'
import { GAME, isPlayableEquip } from '@/core/data'
import library from '@/core/data/raw/ocr-library.json'
import { MODEL } from '@/core/ocr/model'
import { anchoredPiece, occupiedCells, validGrid } from '@/core/ocr/geometry'
import { needsReview, rebuildCoverage, reviewRecognition, setExcluded } from '@/core/ocr/draft'
import { detectAwaken } from '@/core/ocr/awaken'
import glyphs from '@/core/data/raw/awaken-glyphs.json'
import { matchArt, recognizeGrid, type RecognitionCell } from '@/core/ocr/recognize'
import { refreshConflicts, spatialConflicts } from '@/core/ocr/conflicts'
import type { ElderConfig } from '@/core/types'
import { FIXTURES_AVAILABLE, loadFixture, manifest } from './fixtures'

export const emptyCells = (): RecognitionCell[] => Array.from({ length: 42 }, (_, i) => ({
  row: Math.floor(i / 7), col: i % 7, kind: 'empty', equipId: null, awaken: null, confirmed: true, candidates: [], reason: '',
}))
const red = GAME.equips.find((e) => e.name === '朔气飞星')!
const configs: Record<number, ElderConfig> = { [red.elderId!]: { elderId: red.elderId!, owned: true, star: 3, awakenCap: 3 } }
const setPiece = (cells: RecognitionCell[], index: number, id: number, awaken: number | null) => {
  Object.assign(cells[index], { kind: 'piece', equipId: id, awaken, confirmed: true })
  rebuildCoverage(cells)
}

describe('原生图库与像素识别', () => {
  it('完整覆盖可用的368件法宝，只有稀疏有限数值而非原始图片', () => {
    expect(library.templates.map((t) => t.id).sort()).toEqual(GAME.equips.filter(isPlayableEquip).map((e) => e.id).sort())
    expect(library.sources).toEqual({ apk: 288, web: 80 })
    for (const t of library.templates) {
      expect(t.points.length % 5).toBe(0)
      expect(t.points.length).toBeGreaterThan(50)
      expect(t.points.every(Number.isFinite)).toBe(true)
    }
  })
  it('纯空白背包不生成法宝；图外/非数值/过小网格拒绝执行', () => {
    const img = { w: 700, h: 600, px: () => MODEL.palette.empty }
    const grid = { ox: 0, oy: 0, pw: 100, ph: 100 }
    expect(recognizeGrid(img, grid).cells.every((c) => c.kind === 'empty')).toBe(true)
    for (const patch of [{ ox: -1 }, { pw: NaN }, { pw: 0 }, { oy: 999 }]) {
      expect(validGrid(img, { ...grid, ...patch })).toBe(false)
      expect(() => recognizeGrid(img, { ...grid, ...patch })).toThrow()
    }
  })
  it('匹配比较完整多格：锚点相同但后续格错误时，整件得分降低', () => {
    const eq = GAME.equipById[140108]
    const shape = GAME.shapeById[eq.shapeId]
    const points = shape.cells.flatMap(([r, c], index) => Array.from({ length: index ? 4 : 40 }, () => [c * 1000 + 500, r * 1000 + 500, 200, 100, 50]).flat())
    const grid = { ox: 0, oy: 0, pw: 100, ph: 100 }
    const good = { w: 700, h: 600, px: (): [number, number, number] => [200, 100, 50] }
    const wrong = { ...good, px: (x: number, y: number): [number, number, number] => x < 100 && y < 100 ? [200, 100, 50] : [20, 20, 20] }
    expect(matchArt(good, grid, eq, 0, 0, points)).toBe(0)
    expect(matchArt(wrong, grid, eq, 0, 0, points)).toBeGreaterThan(35)
    const native = library.templates.find((t) => t.id === eq.id)!
    const sampled = new Set(native.points.filter((_, i) => i % 5 === 0).map((_, i) => Math.floor(native.points[i * 5 + 1] / 1000) * shape.w + Math.floor(native.points[i * 5] / 1000)))
    expect(sampled.size).toBe(shape.cellCount)
  })
  it('不规则形状正确换算锚点，禁止越界', () => {
    const eq = GAME.equips.find((e) => e.name === '逐日镇岳')!
    expect(anchoredPiece(eq.id, 2, 1)).toMatchObject({ r: 2, c: 0 })
    expect(occupiedCells(eq.id, 2, 1)).toEqual([15, 22, 28, 29])
    expect(occupiedCells(eq.id, 0, 0)).toBeNull()
    expect(anchoredPiece(-1, 0, 0)).toBeNull()
  })
})

describe.skipIf(!FIXTURES_AVAILABLE)('原生图库识别真实截图（人工网格）', () => {
  for (const fixture of manifest.fixtures) it(fixture.file, () => {
    const g = fixture.grid
    const result = recognizeGrid(loadFixture(fixture.file), { ox: g.ox, oy: g.oy, pw: g.pitch, ph: g.pitch })
    expect(result.cells).toHaveLength(42)
    for (const cell of result.cells.filter((c) => c.kind === 'piece')) {
      expect(fixture.elements).toContain(GAME.equipById[cell.equipId!].element)
      expect(occupiedCells(cell.equipId!, cell.row, cell.col)).not.toBeNull()
      if (GAME.equipById[cell.equipId!].elderId === undefined) expect(cell.awaken).toBe(0)
      else expect([0, 1, 2, 3]).toContain(cell.awaken)
      if (!cell.awakenDetected) expect(cell.awaken).toBe(0)
      if (cell.conflicts?.length) expect(needsReview(cell)).toBe(true)
    }
    for (const [r, c] of fixture.empty) expect(result.cells[r * 7 + c].kind).toBe('empty')
    for (const [r, c] of fixture.locked) expect(result.cells[r * 7 + c].kind).toBe('locked')
    for (const red of fixture.reds) {
      const cell = result.cells[red.anchor[0] * 7 + red.anchor[1]]
      expect(cell.kind).toBe('piece')
      expect(GAME.equipById[cell.equipId!].name).toBe(red.name)
      expect(cell.awaken).toBe(cell.awakenDetected ? red.awaken : 0)
    }
  })
  it('金系战斗截图4,5、5,6、5,7交叉：冲突三方均待核对', () => {
    const f = manifest.fixtures.find((f) => f.file === 'battle-metal-01.jpg')!
    const g = f.grid
    const result = recognizeGrid(loadFixture(f.file), { ox: g.ox, oy: g.oy, pw: g.pitch, ph: g.pitch })
    for (const i of [25, 33, 34]) {
      expect(result.cells[i].kind).toBe('piece')
      expect(result.cells[i].conflicts?.length).toBeGreaterThan(0)
      expect(needsReview(result.cells[i])).toBe(true)
    }
    expect(result.cells[25].conflicts?.join()).toContain('5,6')
    expect(result.cells[34].conflicts?.join()).toContain('5,6')
  })
  it('留出角标验证：检测器保留拒识信息，界面默认0而非冒充识别成功', () => {
    let detected = 0, heldOut = 0
    const sources = new Set(glyphs.templates.map((t) => t.source))
    for (const fixture of manifest.fixtures.filter((f) => f.labeled)) {
      const image = loadFixture(fixture.file)
      const g = fixture.grid
      for (const [index, red] of fixture.reds.entries()) {
        if (sources.has(`${fixture.file}#${index}`)) continue
        heldOut++
        const eq = GAME.equips.find((e) => e.name === red.name)!
        const grid = { ox: g.ox, oy: g.oy, pw: g.pitch, ph: g.pitch }
        const occupied = occupiedCells(eq.id, red.anchor[0], red.anchor[1])!
        const level = detectAwaken(image, grid, occupied, 5)
        expect([null, red.awaken], `${fixture.file} ${red.name}`).toContain(level)
        if (level !== null) detected++
        if (red.awaken === 3) expect(detectAwaken(image, grid, occupied, 2)).toBeNull()
      }
    }
    expect(heldOut).toBe(10)
    expect(detected).toBeGreaterThanOrEqual(8)
  })
  it('无角标的纯色区域不误填觉醒', () => {
    for (const color of Object.values(MODEL.palette)) {
      expect(detectAwaken({ w: 700, h: 600, px: () => color }, { ox: 0, oy: 0, pw: 100, ph: 100 }, [0], 5)).toBeNull()
    }
  })
})

describe('识别草稿与导入校验', () => {
  it('重叠关系双向且与遍历顺序无关，手动勾选不能忽略冲突', () => {
    const cells = emptyCells()
    setPiece(cells, 25, 140108, 0)
    setPiece(cells, 33, 110103, 0)
    setPiece(cells, 34, 140103, 0)
    for (const i of [25, 33, 34]) {
      cells[i].confirmed = true
      expect(needsReview(cells[i])).toBe(true)
    }
    expect(reviewRecognition(cells, {}).data).toBeNull()
    const forward = spatialConflicts(cells)
    const swapped = cells.map((c) => ({ ...c }))
    const ids = [140108, 110103, 140103]
    expect([...forward.keys()].sort()).toEqual([25, 33, 34])
    for (const i of [25, 33, 34]) swapped[i].conflicts = []
    const partial = reviewRecognition(swapped, {}, { skipPending: true })
    expect(partial.errors).toEqual([])
    expect(partial.data?.selected).toEqual([])
    expect(cells.filter((c) => ids.includes(c.equipId!))).toHaveLength(3)
    setExcluded(cells, 33, true)
    expect(cells[25].conflicts).toEqual([])
    expect(cells[34].conflicts).toEqual([])
    expect(reviewRecognition(cells, {}).data?.selected).toHaveLength(2)
    setExcluded(cells, 33, false)
    expect(needsReview(cells[25])).toBe(true)
    expect(needsReview(cells[34])).toBe(true)
    setPiece(cells, 33, 110101, 0)
    expect(cells[25].conflicts).toEqual([])
    expect(cells[34].conflicts).toEqual([])
    expect(cells[33].conflicts).toEqual([])
  })
  it('弱锚点不能在手动重算占格时被吞掉，锁格冲突双方提示', () => {
    const cells = emptyCells()
    Object.assign(cells[7], { kind: 'unknown', confirmed: false, anchorEvidence: true })
    setPiece(cells, 0, red.id, 0)
    expect(cells[7].kind).toBe('unknown')
    expect(cells[0].conflicts?.join()).toContain('2,1')
    expect(cells[7].conflicts?.length).toBeGreaterThan(0)
    cells[7].kind = 'locked'
    refreshConflicts(cells)
    expect(cells[0].conflicts?.join()).toContain('未开放格')
    expect(needsReview(cells[7])).toBe(true)
  })
  it('同名红装保留每份不同觉醒及原摆法', () => {
    const cells = emptyCells()
    setPiece(cells, 0, red.id, 0)
    setPiece(cells, 3, red.id, 2)
    cells[41].kind = 'locked'
    const result = reviewRecognition(cells, configs)
    expect(result.errors).toEqual([])
    expect(result.data?.selected).toEqual([{ equipId: red.id, copies: [{ awaken: 0 }, { awaken: 2 }] }])
    expect(result.data?.previousLayout).toEqual([{ equipId: red.id, awaken: 0, r: 0, c: 0 }, { equipId: red.id, awaken: 2, r: 0, c: 3 }])
    expect(result.data?.lockedCells).toEqual([41])
  })
  it('待确认、无效觉醒、账号上限、重叠和锁格冲突均阻止导入', () => {
    const cells = emptyCells()
    setPiece(cells, 0, red.id, null)
    expect(reviewRecognition(cells, configs).data).toBeNull()
    cells[0].awaken = 4
    expect(reviewRecognition(cells, configs).errors.join()).toContain('超过长老')
    cells[0].awaken = 1
    cells[0].confirmed = false
    expect(reviewRecognition(cells, configs).data).toBeNull()
    cells[0].confirmed = true
    cells[7].kind = 'locked'
    expect(reviewRecognition(cells, configs).errors).toContain('法宝与未开放格重叠')
    cells[7].kind = 'covered'
    setPiece(cells, 1, red.id, 0)
    expect(reviewRecognition(cells, configs).errors.join()).toContain('占格重叠')
  })
  it('删除/换小形状后旧占格需重新核对，不默默吞掉未知法宝', () => {
    const cells = emptyCells()
    setPiece(cells, 0, red.id, 0)
    cells[0].kind = 'empty'; cells[0].equipId = null
    rebuildCoverage(cells)
    expect(cells[7].kind).toBe('unknown')
    expect(reviewRecognition(cells, configs).data).toBeNull()
  })
  it('删除单份释放整件占格；恢复不丢觉醒，不删除同名其它副本', () => {
    const cells = emptyCells()
    setPiece(cells, 0, red.id, 2)
    setPiece(cells, 3, red.id, 1)
    setExcluded(cells, 0, true)
    expect(needsReview(cells[0])).toBe(false)
    expect(cells[7].kind).toBe('empty')
    expect(reviewRecognition(cells, configs).data?.selected[0].copies).toEqual([{ awaken: 1 }])
    setExcluded(cells, 0, false)
    expect(cells[7].kind).toBe('covered')
    expect(reviewRecognition(cells, configs).data?.selected[0].copies).toEqual([{ awaken: 2 }, { awaken: 1 }])
  })
  it('跳过待核对法宝不修改草稿，保留其它副本位置和锁格', () => {
    const cells = emptyCells()
    setPiece(cells, 0, red.id, null)
    setPiece(cells, 3, red.id, 2)
    cells[41].kind = 'locked'
    cells[40].kind = 'unknown'; cells[40].confirmed = false
    const before = JSON.stringify(cells)
    const result = reviewRecognition(cells, configs, { skipPending: true })
    expect(result.errors).toEqual([])
    expect(result.data?.previousLayout).toEqual([{ equipId: red.id, awaken: 2, r: 0, c: 3 }])
    expect(result.data?.lockedCells).toEqual([41])
    expect(JSON.stringify(cells)).toBe(before)
    expect(reviewRecognition(cells, configs).data).toBeNull()
    cells[41].confirmed = false
    expect(reviewRecognition(cells, configs, { skipPending: true }).data).toBeNull()
  })
  it('跳过模式不绕过剩余法宝的长老约束', () => {
    const cells = emptyCells()
    setPiece(cells, 0, red.id, 2)
    expect(reviewRecognition(cells, {}, { skipPending: true }).data).toBeNull()
  })
  it('普通法宝始终按未觉醒导入；残缺网格拒绝导入', () => {
    const cells = emptyCells()
    setPiece(cells, 0, 110101, 3)
    expect(reviewRecognition(cells, {}).data?.selected[0].copies).toEqual([{ awaken: 0 }])
    expect(reviewRecognition(cells.slice(1), {}).data).toBeNull()
  })
})
