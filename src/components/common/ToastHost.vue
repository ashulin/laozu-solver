<script setup lang="ts">
import { useToasts } from '@/composables/toast'
const toasts = useToasts()
</script>

<template>
  <div class="toast-host" aria-live="polite">
    <div v-for="t in toasts.list" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  left: 50%;
  bottom: 84px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 100;
  pointer-events: none;
}
/* 窄屏有底部操作条，提示再抬高一点避免被遮住 */
@media (max-width: 900px) {
  .toast-host { bottom: 96px; }
}
.toast {
  background: #2a3040;
  border: 1px solid var(--line);
  padding: 8px 14px;
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  max-width: 86vw;
}
.toast.warn { border-color: var(--warn); color: var(--warn); }
.toast.ok { border-color: var(--ok); color: var(--ok); }
</style>
