import { describe, expect, it } from 'vitest'
import { extractObject, quoteNumericKeys, sliceBalanced } from '../../scripts/extract-data.mjs'

describe('sliceBalanced', () => {
  it('配平嵌套括号', () => {
    const src = 'const X={a:{b:1},c:[{d:2}]};rest'
    expect(sliceBalanced(src, src.indexOf('{'))).toBe('{a:{b:1},c:[{d:2}]}')
  })
  it('忽略字符串和注释里的括号', () => {
    const src = 'const X={a:"}{",/* } */b:1, // }\nc:\'{\'};'
    expect(sliceBalanced(src, src.indexOf('{'))).toBe('{a:"}{",/* } */b:1, // }\nc:\'{\'}')
  })
  it('起点不是 { 时报错', () => {
    expect(() => sliceBalanced('abc', 0)).toThrow()
  })
  it('括号未闭合时报错', () => {
    expect(() => sliceBalanced('{a:{', 0)).toThrow('括号未闭合')
  })
})

describe('quoteNumericKeys', () => {
  it('给数字键加引号', () => {
    expect(quoteNumericKeys('{150103:{maxLevel:5,levels:{1:[1]}}}')).toBe('{"150103":{maxLevel:5,levels:{"1":[1]}}}')
  })
  it('不改动字符串内容与数组元素', () => {
    expect(quoteNumericKeys('{a:"x,1:y",b:[1, 2]}')).toBe('{a:"x,1:y",b:[1, 2]}')
  })
  it('不改动注释', () => {
    expect(quoteNumericKeys('{1:2, // ,3:4\n5:6}')).toBe('{"1":2, // ,3:4\n"5":6}')
  })
})

describe('extractObject', () => {
  it('解析带注释、数字键、尾逗号的 JS 字面量', () => {
    const src = `const AWAKEN_DB={
150103:{ // 金辉裂穹
  maxLevel:5,
  levels:{ 1:[{type:"self_mult",pct:2000}], },
},
};`
    expect(extractObject(src, 'const AWAKEN_DB=')).toEqual({
      150103: { maxLevel: 5, levels: { 1: [{ type: 'self_mult', pct: 2000 }] } },
    })
  })
  it('找不到标记时报错', () => {
    expect(() => extractObject('const A={}', 'const B=')).toThrow('未找到')
  })
})
