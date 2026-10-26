#!/usr/bin/env node
/**
 * 从觉醒版（Eleven-tz/laozu-solver-juexing）index.html 中提取游戏数据，写入 src/core/data/raw/。
 *
 * 安全说明：只做字符串截取 + JSON5 解析，不 eval / new Function 执行来源代码。
 *
 * 用法：npm run extract-data -- /path/to/laozu-solver-juexing/index.html
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSON5 from 'json5'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = resolve(ROOT, 'src/core/data/raw')

/** 从 start（应指向 '{'）开始做括号配平，跳过字符串与注释，返回字面量文本 */
export function sliceBalanced(src, start) {
  if (src[start] !== '{') throw new Error(`位置 ${start} 不是 '{'`)
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch
      i++
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i++
        i++
      }
      continue
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2)
      if (i < 0) throw new Error('块注释未闭合')
      i++
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error('括号未闭合')
}

/**
 * JSON5 不接受无引号的数字键（如 `150103:{...}`）。逐字符扫描，跳过字符串与注释，
 * 把「{ 或 , 之后的纯数字 + :」改成带引号的键。
 */
export function quoteNumericKeys(text) {
  let out = ''
  let i = 0
  let expectKey = false
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1
      while (j < text.length && text[j] !== ch) {
        if (text[j] === '\\') j++
        j++
      }
      out += text.slice(i, j + 1)
      i = j + 1
      expectKey = false
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      const j = text.indexOf('\n', i)
      const end = j < 0 ? text.length : j
      out += text.slice(i, end)
      i = end
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2) + 2
      out += text.slice(i, end)
      i = end
      continue
    }
    if (ch === '{' || ch === ',') {
      out += ch
      i++
      expectKey = true
      continue
    }
    if (expectKey && /\s/.test(ch)) {
      out += ch
      i++
      continue
    }
    if (expectKey && /\d/.test(ch)) {
      const m = /^(\d+)(\s*):/.exec(text.slice(i))
      if (m) {
        out += `"${m[1]}"${m[2]}:`
        i += m[0].length
        expectKey = false
        continue
      }
    }
    expectKey = false
    out += ch
    i++
  }
  return out
}

/** 查找 `marker` 后第一个 '{' 开始的对象字面量并解析 */
export function extractObject(src, marker) {
  const at = src.indexOf(marker)
  if (at < 0) throw new Error(`未找到 ${marker}`)
  const brace = src.indexOf('{', at + marker.length)
  return JSON5.parse(quoteNumericKeys(sliceBalanced(src, brace)))
}

export function extractAll(src) {
  const db = extractObject(src, 'const DB=')
  const elderMap = extractObject(src, 'const ELDER_MAP=')
  const awakenDb = extractObject(src, 'const AWAKEN_DB=')
  const ocr = extractObject(src, 'globalThis.OCR_DATA=')
  delete ocr.WORKER_SRC // 觉醒版为空串，无用
  return { db, elderMap, awakenDb, ocr }
}

function writeJson(name, data) {
  const file = resolve(OUT_DIR, name)
  writeFileSync(file, JSON.stringify(data) + '\n')
  return file
}

function main() {
  const input = process.argv[2]
  if (!input) {
    console.error('用法：npm run extract-data -- /path/to/laozu-solver-juexing/index.html')
    process.exit(1)
  }
  const src = readFileSync(resolve(input), 'utf8')
  const { db, elderMap, awakenDb, ocr } = extractAll(src)
  mkdirSync(OUT_DIR, { recursive: true })
  writeJson('game-db.json', db)
  writeJson('elder-map.json', elderMap)
  writeJson('awaken-db.json', awakenDb)
  writeJson('ocr-data.json', ocr)
  console.log(`法宝 ${db.equips.length} 件 · 形状 ${Object.keys(db.shapes).length} · 技能 ${db.skills.length} · 天赋 ${db.talents.length}`)
  console.log(`长老 ${Object.keys(elderMap).length} 位 · 觉醒数据 ${Object.keys(awakenDb).length} 件 · 签名 ${ocr.OT.length} 条`)
  console.log(`已写入 ${OUT_DIR}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
