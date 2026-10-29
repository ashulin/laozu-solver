<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
import { DATA_VERSION } from '@/core/data/version'
import BottomBar from '@/components/common/BottomBar.vue'
import ToastHost from '@/components/common/ToastHost.vue'
import { NAV_TABS } from '@/router/tabs'

const tabs = NAV_TABS
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
      <span class="ver muted small" :title="`法宝数据 ${DATA_VERSION.equips}，觉醒数据 ${DATA_VERSION.awaken}`">数据 {{ DATA_VERSION.equips }}</span>
    </div>
    <nav class="tabs">
      <RouterLink v-for="t in tabs" :key="t.to" :to="t.to" class="tab" active-class="on">{{ t.label }}</RouterLink>
    </nav>
  </header>
  <main class="app-main">
    <RouterView />
  </main>
  <BottomBar />
  <ToastHost />
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
  .title, .ver { display: none; }
  .app-main { padding: 10px; }
}
/* 底部操作条只在窄屏出现，给主内容留出避让空间 */
@media (max-width: 900px) {
  .app-main { padding-bottom: 72px; }
}
</style>
