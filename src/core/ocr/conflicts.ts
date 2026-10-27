import { occupiedCells } from './geometry'
import type { RecognitionCell } from './recognize'

const position = (index: number) => `${Math.floor(index / 7) + 1},${index % 7 + 1}`

/** 整盘双向占格校验，不受候选遍历顺序或人工勾选状态影响。 */
export function spatialConflicts(cells: RecognitionCell[]): Map<number, string[]> {
  const messages = new Map<number, Set<string>>()
  const owners = new Map<number, number[]>()
  const add = (index: number, text: string) => {
    const list = messages.get(index) ?? new Set<string>()
    list.add(text); messages.set(index, list)
  }
  cells.forEach((cell, index) => {
    if (cell.kind !== 'piece' || cell.excluded || !cell.equipId) return
    const occupied = occupiedCells(cell.equipId, cell.row, cell.col)
    if (!occupied) { add(index, '法宝形状超出背包'); return }
    for (const i of occupied) {
      const list = owners.get(i) ?? []
      list.push(index); owners.set(i, list)
      if (cells[i]?.kind === 'locked') {
        add(index, `占用未开放格 ${position(i)}`)
        add(i, `与法宝 ${position(index)} 占格冲突`)
      }
      if (i !== index && cells[i]?.kind === 'unknown' && cells[i].anchorEvidence && !cells[i].excluded) {
        add(index, `覆盖待识别锚点 ${position(i)}`)
        add(i, `被法宝 ${position(index)} 的候选形状覆盖`)
      }
    }
  })
  for (const [cell, list] of owners) {
    if (list.length < 2) continue
    for (const index of list) for (const other of list) if (index !== other) {
      add(index, `与 ${position(other)} 在 ${position(cell)} 占格重叠`)
    }
  }
  return new Map([...messages].map(([index, list]) => [index, [...list]]))
}

export function refreshConflicts(cells: RecognitionCell[]): void {
  const conflicts = spatialConflicts(cells)
  cells.forEach((cell, index) => { cell.conflicts = conflicts.get(index) ?? [] })
}
