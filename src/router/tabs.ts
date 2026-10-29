/** 顶部与底部导航共用的标签定义 */
export interface NavTab {
  to: string
  label: string
  icon: string
}

export const NAV_TABS: NavTab[] = [
  { to: '/recognize', label: '截图识别', icon: '▣' },
  { to: '/solver', label: '优化器', icon: '◈' },
  { to: '/elders', label: '长老管理', icon: '☰' },
]
