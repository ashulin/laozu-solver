import { createRouter, createWebHashHistory } from 'vue-router'

// hash 模式：GitHub Pages 没有服务端 rewrite，history 模式刷新会 404
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/solver' },
    { path: '/solver', name: 'solver', component: () => import('@/views/SolverView.vue'), meta: { title: '优化器' } },
    { path: '/elders', name: 'elders', component: () => import('@/views/EldersView.vue'), meta: { title: '长老管理' } },
    { path: '/recognize', name: 'recognize', component: () => import('@/views/RecognizeView.vue'), meta: { title: '截图识别' } },
    { path: '/:pathMatch(.*)*', redirect: '/solver' },
  ],
})
