/**
 * 把多张图拼成一张横排拼图（顶部对齐，灰色间隔），便于一次查看多张截图。
 * 用法：npx tsx scripts/montage.ts 输出.jpg 每张最大边长 图1 图2 ...
 */
import { cropScale, readImage, writeJpeg, type RawImage } from './image-io'

const [outPath, maxSideArg, ...inputs] = process.argv.slice(2)
const maxSide = Number(maxSideArg)
const tiles: RawImage[] = inputs.map((p) => {
  const img = readImage(p)
  return cropScale(img, 0, 0, img.width, img.height, maxSide)
})
const gap = 8
const W = tiles.reduce((a, t) => a + t.width, 0) + gap * (tiles.length - 1)
const H = Math.max(...tiles.map((t) => t.height))
const data = new Uint8Array(W * H * 4).fill(60)
let x0 = 0
for (const t of tiles) {
  for (let y = 0; y < t.height; y++) {
    data.set(t.data.subarray(y * t.width * 4, (y + 1) * t.width * 4), (y * W + x0) * 4)
  }
  x0 += t.width + gap
}
writeJpeg(outPath, { width: W, height: H, data })
