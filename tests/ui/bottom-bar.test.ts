// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { memoryStorage, setStorageBackend } from '@/services/app-storage'
import { useBagStore } from '@/stores/bag'
import { useSolverStore } from '@/stores/solver'
import BottomBar from '@/components/common/BottomBar.vue'
import { NAV_TABS } from '@/router/tabs'

const route = reactive({ path: '/solver' })
vi.mock('vue-router', () => ({ useRoute: () => route }))

const wrappers: ReturnType<typeof mount>[] = []
const create = () => {
  const w = mount(BottomBar)
  wrappers.push(w)
  return w
}

beforeEach(() => {
  route.path = '/solver'
  setStorageBackend(memoryStorage())
  setActivePinia(createPinia())
})
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount())
  vi.restoreAllMocks()
})

describe('底部操作条', () => {
  it('是优化器内部的功能点导航，不重复顶部的全局标签', () => {
    const w = create()
    for (const label of ['目录', '已选', '摆盘', '目标', '日志']) expect(w.text()).toContain(label)
    for (const t of NAV_TABS) expect(w.text()).not.toContain(t.label)
    expect(w.findAll('.tabs button')).toHaveLength(5)
  })

  it('只在优化器页显示', async () => {
    const w = create()
    expect(w.find('.bottom-bar').exists()).toBe(true)
    route.path = '/recognize'
    await flushPromises()
    expect(w.find('.bottom-bar').exists()).toBe(false)
  })

  it('点击功能点滚动到对应面板', async () => {
    const el = document.createElement('section')
    el.id = 'solver-selected'
    el.scrollIntoView = vi.fn()
    document.body.appendChild(el)
    const w = create()
    await w.findAll('.tabs button')[1].trigger('click')
    expect(el.scrollIntoView).toHaveBeenCalled()
    el.remove()
  })

  it('求解按钮：没有法宝时禁用，有法宝后可点并触发求解', async () => {
    const w = create()
    const solver = useSolverStore()
    const start = vi.spyOn(solver, 'start').mockImplementation(() => true)
    const button = () => w.find('.solve button')
    expect(button().text()).toBe('求解')
    expect(button().attributes('disabled')).toBeDefined()

    useBagStore().add(110101)
    await flushPromises()
    expect(button().attributes('disabled')).toBeUndefined()
    await button().trigger('click')
    expect(start).toHaveBeenCalled()
  })

  it('求解中显示进度与中止，点击中止', async () => {
    const w = create()
    const solver = useSolverStore()
    solver.running = true
    solver.startedAt = Date.now()
    await flushPromises()
    expect(w.find('.progress').exists()).toBe(true)
    expect(w.find('.solve button').text()).toBe('中止')
    const stop = vi.spyOn(solver, 'stop').mockImplementation(() => true)
    await w.find('.solve button').trigger('click')
    expect(stop).toHaveBeenCalled()
  })
})
