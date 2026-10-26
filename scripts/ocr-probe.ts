/** 诊断：在指定网格下计算底色分、锚点数与外框得分。用法：npx tsx scripts/ocr-probe.ts 文件名 ox oy pitch */
import { join } from 'node:path'
import { countAnchors, fitGrid, frameScore, gridScore } from '../src/core/ocr/fit'
import { fromRgba } from '../src/core/ocr/sampling'
import { readImage } from './image-io'

const [file, ox, oy, p] = process.argv.slice(2)
const raw = readImage(join('tests/fixtures/ocr', file))
const img = fromRgba(raw.width, raw.height, raw.data)
const fit = fitGrid(img)
const show = (name: string, g: { ox: number; oy: number; pw: number; ph: number }) =>
  console.log(`${name.padEnd(6)} (${g.ox.toFixed(1)}, ${g.oy.toFixed(1)}, ${g.pw.toFixed(2)})  底色分 ${gridScore(img, g).toFixed(1)}  锚点 ${countAnchors(img, g)}  外框 ${frameScore(img, g).toFixed(2)}`)
show('定位', fit.grid)
if (ox) show('指定', { ox: +ox, oy: +oy, pw: +p, ph: +p })
