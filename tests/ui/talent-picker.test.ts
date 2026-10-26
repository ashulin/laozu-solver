// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { GAME } from '@/core/data'
import { talentGroups } from '@/core/talents'
import TalentPicker from '@/components/settings/TalentPicker.vue'

const byName = (n: string) => GAME.talents.find((t) => t.name === n)!

describe('talentGroups', () => {
  const groups = talentGroups(GAME)

  it('按形态顺序分组（剑乐异御枪刀锤幡），覆盖全部 40 个天赋', () => {
    expect(groups.map((g) => g.form)).toEqual([2, 3, 4, 5, 6, 7, 8, 9])
    expect(groups.reduce((a, g) => a + g.talents.length, 0)).toBe(GAME.talents.length)
    for (const g of groups) expect(g.talents.every((t) => t.form === g.form)).toBe(true)
  })

  it('组内加成高的在前', () => {
    for (const g of groups) {
      const vals = g.talents.map((t) => t.value)
      expect(vals).toEqual([...vals].sort((a, b) => b - a))
    }
  })
})

describe('TalentPicker', () => {
  let w: VueWrapper | null = null
  afterEach(() => {
    w?.unmount()
    w = null
  })

  const mk = (modelValue: number | null, disabledIds: (number | null)[] = []) => {
    const updates: (number | null)[] = []
    w = mount(TalentPicker, {
      props: { modelValue, label: '天赋1', disabledIds, 'onUpdate:modelValue': (v: number | null) => updates.push(v) },
      attachTo: document.body,
    })
    return { w, updates }
  }
  const formBtn = (w: VueWrapper, name: string) => w.findAll('.form-btn').find((b) => b.text().startsWith(name))!

  it('未选时显示「无」，点开后一级列出 无 + 8 种形态（带数量）', async () => {
    const { w } = mk(null)
    expect(w.find('.trigger').text()).toContain('天赋1：无')
    expect(w.find('.panel').exists()).toBe(false)
    await w.find('.trigger').trigger('click')
    const forms = w.findAll('.form-btn').map((b) => b.text())
    expect(forms[0]).toBe('无')
    expect(forms.slice(1)).toEqual(['剑5', '乐3', '异5', '御7', '枪9', '刀3', '锤5', '幡3'])
  })

  it('二级只列当前形态的天赋；切换形态后列表跟着变', async () => {
    const { w } = mk(null)
    await w.find('.trigger').trigger('click')
    await formBtn(w, '乐').trigger('click')
    expect(w.findAll('.talent-btn b').map((b) => b.text())).toEqual(['乐圣转世', '乐仙转世', '乐痴'])
    await formBtn(w, '枪').trigger('mouseenter')
    expect(w.findAll('.talent-btn')).toHaveLength(9)
  })

  it('选中具体天赋后回写并关闭', async () => {
    const { w, updates } = mk(null)
    await w.find('.trigger').trigger('click')
    await formBtn(w, '御').trigger('click')
    await w.findAll('.talent-btn').find((b) => b.text().includes('天枢转世'))!.trigger('click')
    expect(updates).toEqual([byName('天枢转世').id])
    expect(w.find('.panel').exists()).toBe(false)
  })

  it('已选时按钮显示形态、名称、加成；打开后直接定位到该形态', async () => {
    const { w } = mk(byName('锤圣转世').id)
    expect(w.find('.trigger').text()).toContain('锤')
    expect(w.find('.trigger').text()).toContain('锤圣转世')
    expect(w.find('.trigger').text()).toContain('+12%')
    await w.find('.trigger').trigger('click')
    expect(w.find('.form-btn.on').text()).toContain('锤')
    expect(w.find('.talent-btn.sel').text()).toContain('锤圣转世')
  })

  it('选「无」清空', async () => {
    const { w, updates } = mk(byName('剑痴').id)
    await w.find('.trigger').trigger('click')
    await w.find('.form-btn.none').trigger('click')
    expect(updates).toEqual([null])
  })

  it('其它槽位已选的天赋置灰不可选；自己当前选中的不受影响', async () => {
    const own = byName('剑痴').id
    const other = byName('剑圣转世').id
    const { w } = mk(own, [own, other, null, null])
    await w.find('.trigger').trigger('click')
    const btn = (n: string) => w.findAll('.talent-btn').find((b) => b.text().includes(n))!
    expect(btn('剑圣转世').attributes('disabled')).toBeDefined()
    expect(btn('剑圣转世').text()).toContain('其它槽位已选')
    expect(btn('剑痴').attributes('disabled')).toBeUndefined()
  })

  it('Esc 与点击外部关闭', async () => {
    const { w } = mk(null)
    await w.find('.trigger').trigger('click')
    await w.find('.panel').trigger('keydown', { key: 'Escape' })
    expect(w.find('.panel').exists()).toBe(false)
    await w.find('.trigger').trigger('click')
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await w.vm.$nextTick()
    expect(w.find('.panel').exists()).toBe(false)
  })
})
