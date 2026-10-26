<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'

const tabs = [
  { to: '/recognize', label: '截图识别' },
  { to: '/solver', label: '优化器' },
  { to: '/elders', label: '长老管理' },
]
</script>

<template>
  <header class="app-header">
    <div class="brand">
      <svg class="logo" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="9.5" y1="3" x2="9.5" y2="21" />
        <line x1="16" y1="3" x2="16" y2="21" />
        <line x1="3" y1="12" x2="21" y2="12" />
      </svg>
      <span class="title">我要当老祖 · 法宝摆盘</span>
    </div>
    <nav class="tabs">
      <RouterLink v-for="t in tabs" :key="t.to" :to="t.to" class="tab" active-class="on">{{ t.label }}</RouterLink>
    </nav>
  </header>
  <main class="app-main">
    <RouterView />
  </main>
</template>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--line);
}
.brand { display: flex; align-items: center; gap: 8px; color: var(--gold); font-weight: 700; }
.tabs { display: flex; gap: 4px; margin-left: auto; }
.tab {
  padding: 6px 12px;
  border-radius: 8px;
  color: var(--text-dim);
  text-decoration: none;
}
.tab:hover { background: var(--bg-hover); color: var(--text); }
.tab.on { background: var(--gold-weak); color: var(--gold); }
.app-main { max-width: 1440px; margin: 0 auto; padding: 16px; }
@media (max-width: 640px) {
  .title { display: none; }
  .app-main { padding: 10px; }
}
</style>
