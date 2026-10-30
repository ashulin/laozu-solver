import { describe, expect, it } from 'vitest'
import { GAME, isPlayableEquip } from '@/core/data'
import library from '@/core/data/raw/ocr-library.json'
import { decodeTemplate, MODEL } from '@/core/ocr/model'
import { ELEMENT_NAME } from '@/core/types'
import { anchoredPiece, occupiedCells, validGrid } from '@/core/ocr/geometry'
import { needsReview, rebuildCoverage, reviewRecognition, setExcluded } from '@/core/ocr/draft'
import { detectAwaken } from '@/core/ocr/awaken'
import glyphs from '@/core/data/raw/awaken-glyphs.json'
import { matchArt, maskedBackground, rankCandidates, recognizeGrid, resonanceOf, type CellAnalysis, type RecognitionCell } from '@/core/ocr/recognize'
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
  it('形状掩码反采底色：避开图案与角标，返回纯底色', () => {
    const eq = GAME.equips.find((e) => e.elderId === undefined && GAME.shapeById[e.shapeId].cellCount === 4
      && GAME.equips.some((n) => n.name === e.name && n.tier === e.tier + 1))!
    const next = GAME.equips.find((n) => n.name === eq.name && n.tier === eq.tier + 1)!
    const tpl = library.templates.find((t) => t.id === eq.id)!
    const grid = { ox: 0, oy: 0, pw: 100, ph: 100 }
    const bg = MODEL.palette.q2
    const art: [number, number, number] = [10, 10, 10]
    // 占格内模板采样点位置涂成图案色（含同件高阶模板的并集），其余全是底色
    const both = [tpl.points, library.templates.find((t) => t.id === next.id)!.points]
    const img = {
      w: 700, h: 600,
      px: (x: number, y: number): [number, number, number] => {
        const c = x / 100, r = y / 100
        for (const points of both) for (let i = 0; i < points.length; i += 5) {
          const tx = points[i] / 1000, ty = points[i + 1] / 1000
          if (Math.floor(tx) === Math.floor(c) && Math.floor(ty) === Math.floor(r)
            && Math.abs((tx % 1) - (c % 1)) < 0.05 && Math.abs((ty % 1) - (r % 1)) < 0.05) return art
        }
        return bg
      },
    }
    const got = maskedBackground(img, grid, 0, 0, [eq.id, next.id])
    expect(got).not.toBeNull()
    // 掩码外的采样点全部落在底色上：与 q2 的距离远小于与 q4 的距离
    const dist = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0))
    expect(dist(got!, bg)).toBeLessThan(8)
    expect(dist(got!, MODEL.palette.q4)).toBeGreaterThan(40)
    // 未知法宝没有模板时返回 null，不误采
    expect(maskedBackground(img, grid, 0, 0, [-1])).toBeNull()
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
    expect(heldOut).toBe(14)
    expect(detected).toBeGreaterThanOrEqual(8)
  })
  it('无角标的纯色区域不误填觉醒', () => {
    for (const color of Object.values(MODEL.palette)) {
      expect(detectAwaken({ w: 700, h: 600, px: () => color }, { ox: 0, oy: 0, pw: 100, ph: 100 }, [0], 5)).toBeNull()
    }
  })
  it('同件多阶图案打平且边带污染时，掩码底色裁决选对阶并自动确认', () => {
    // 玄黄令 T1/T2 是全库图案最相似的同名对（平均色差 13.8）
    const low = GAME.equips.find((e) => e.name === '玄黄令' && e.tier === 1)!
    const high = GAME.equips.find((e) => e.name === '玄黄令' && e.tier === 2)!
    const points = (id: number) => library.templates.find((t) => t.id === id)!.points
    const glyph = decodeTemplate(MODEL.templates.element[ELEMENT_NAME[low.element]])
    const grid = { ox: 0, oy: 0, pw: 100, ph: 100 }
    const layer: { x: number, y: number, c: [number, number, number] }[] = []
    /** 放一件法宝：底色 + 边带污染（模拟阴影让 analyze 边带中位数测错品阶）+ 图案 + 元素标；共鸣数字不画 */
    const place = (id: number, row: number, col: number, wrongQuality: number) => {
      const eq = GAME.equipById[id]
      const q = MODEL.palette[('q' + eq.quality) as 'q1']
      const wrong = MODEL.palette[('q' + wrongQuality) as 'q1']
      for (const [dr, dc] of GAME.shapeById[eq.shapeId].cells) {
        for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
          // 顶/左/右三条边带（bgInset=7px 采样线所在）涂错误品阶色，模拟真实截图的边带污染
          const c = y >= 5 && y <= 9 || x >= 5 && x <= 9 || x >= 91 && x <= 95 ? wrong : q
          layer.push({ x: (col + dc) * 100 + x, y: (row + dr) * 100 + y, c })
        }
      }
      for (let i = 0; i < points(id).length; i += 5) {
        layer.push({
          x: Math.round((col + points(id)[i] / 1000) * 100),
          y: Math.round((row + points(id)[i + 1] / 1000) * 100),
          c: [points(id)[i + 2], points(id)[i + 3], points(id)[i + 4]],
        })
      }
      // 元素标：锚点格左上按字形位图涂暗色（与 samplePatch 的 (i+0.5) 采样中心对齐）
      const geo = MODEL.geometry
      for (let j = 0; j < 18; j++) for (let i = 0; i < 18; i++) {
        const fx = geo.elementBox[0] + (i + 0.5) / 18 * (geo.elementBox[2] - geo.elementBox[0])
        const fy = geo.elementBox[1] + (j + 0.5) / 18 * (geo.elementBox[3] - geo.elementBox[1])
        // 模板 +1 位是亮笔画、-1 位是深色圆底
        layer.push({ x: Math.round((col + fx) * 100), y: Math.round((row + fy) * 100), c: glyph[j * 18 + i] > 0 ? [235, 235, 235] : [40, 40, 40] })
      }
    }
    place(high.id, 0, 0, 1) // T2 图案 + q2 底色，边带污染成 q1 → 品阶惩罚会把首选偏到 T1
    place(low.id, 2, 2, 2)  // T1 图案 + q1 底色，边带污染成 q2 → 反向对照
    const pix = new Map<string, [number, number, number]>()
    for (const p of layer) pix.set(p.x + ',' + p.y, p.c)
    const img = {
      w: 700, h: 600,
      px: (x: number, y: number): [number, number, number] => pix.get(x + ',' + y) ?? MODEL.palette.empty,
    }
    const result = recognizeGrid(img, grid)
    // 高阶格：图案打平 + 底色测错 + 无共鸣数字 → 掩码底色裁决选回 T2
    const cellHigh = result.cells[0]
    expect(cellHigh.kind).toBe('piece')
    expect(cellHigh.equipId).toBe(high.id)
    expect(cellHigh.confirmed).toBe(true)
    expect(cellHigh.reason).toBe('底色品阶清晰，已自动确认')
    // 对照格：反向污染也选回 T1
    const anchor = GAME.shapeById[low.shapeId].cells[0]
    const cellLow = result.cells[(2 + anchor[0]) * 7 + (2 + anchor[1])]
    expect(cellLow.kind).toBe('piece')
    expect(cellLow.equipId).toBe(low.id)
    expect(cellLow.confirmed).toBe(true)
  })

})

describe('元素、形态与共鸣值证据', () => {
  const evidence = (patch: Partial<CellAnalysis> = {}): CellAnalysis => ({
    kind: 'unknown', anchor: true, strongAnchor: false, element: null, quality: null,
    distances: [], qualityDistances: [], form: null, formScore: 0, number: null, numberScore: 0, numberAt: [], ...patch,
  })

  it('共鸣值按占格数与阶推导，红法宝只随占格数变化', () => {
    const size = (id: number) => GAME.shapeById[GAME.equipById[id].shapeId].cellCount
    const normal = GAME.equips.find((e) => e.elderId === undefined && size(e.id) === 3)!
    const one = GAME.equips.find((e) => e.elderId === undefined && size(e.id) === 1)!
    expect(resonanceOf(normal.id)).toBe(8 * 4 * 2 ** (normal.tier - 4))
    expect(resonanceOf(one.id)).toBe(8 * 2 * 2 ** (one.tier - 4))
    // 四阶基准：1格16、2格24、3格32、4格40
    for (const [cells, value] of [[1, 16], [2, 24], [3, 32], [4, 40]]) {
      const eq = GAME.equips.find((e) => e.elderId === undefined && e.tier === 4 && size(e.id) === cells)!
      expect(resonanceOf(eq.id), `${cells}格四阶`).toBe(value)
    }
    const reds = GAME.equips.filter((e) => e.elderId !== undefined)
    expect(new Set(reds.map((e) => size(e.id))).size).toBeGreaterThan(1)
    for (const e of reds) expect(resonanceOf(e.id), `${e.name} 觉醒无关`).toBe({ 3: 32, 4: 56, 5: 64 }[size(e.id)])
  })

  it('共鸣值与形态命中时同类证据一致，读错则退回全量', () => {
    const fixture = manifest.fixtures.find((f) => f.file === 'outgame-earth-04.jpg')!
    const image = loadFixture(fixture.file)
    const g = { ox: fixture.grid.ox, oy: fixture.grid.oy, pw: fixture.grid.pitch, ph: fixture.grid.pitch }
    const all = rankCandidates(image, g, 0, evidence({}))
    expect(all.length).toBeGreaterThan(1)
    const top = all[0]
    const reson = resonanceOf(top.equipId)!
    // 右下标落在最下最右占格，按该偏移写入读数
    const cells = GAME.shapeById[GAME.equipById[top.equipId].shapeId].cells
    const first = [...cells].sort((a, b) => a[0] - b[0] || a[1] - b[1])[0]
    const last = [...cells].sort((a, b) => b[0] - a[0] || b[1] - a[1])[0]
    const numberAt: { value: number; score: number }[][] = []
    numberAt[last[0] - first[0]] = []
    numberAt[last[0] - first[0]][last[1] - first[1]] = { value: reson, score: 0.8 }
    const hit = rankCandidates(image, g, 0, evidence({ numberAt }))
    expect(hit.length).toBeGreaterThan(0)
    expect(hit.every((c) => resonanceOf(c.equipId) === reson)).toBe(true)
    expect(hit[0].equipId).toBe(top.equipId)

    const form = GAME.equipById[top.equipId].weaponForm
    const byForm = rankCandidates(image, g, 0, evidence({ form }))
    expect(byForm.length).toBeGreaterThan(0)
    expect(byForm.every((c) => GAME.equipById[c.equipId].weaponForm === form)).toBe(true)

    // 与所有候选都不符的共鸣值不能把候选清空
    const bogus = rankCandidates(image, g, 0, evidence({ number: 7 }))
    expect(bogus.map((c) => c.equipId)).toEqual(all.map((c) => c.equipId))
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
    expect(result.data?.selected).toMatchObject([{ equipId: red.id, copies: [{ awaken: 0 }, { awaken: 2 }] }])
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
