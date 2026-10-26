import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { enableAutoPersist } from './stores/persist'
import './styles/base.css'

const pinia = createPinia()
createApp(App).use(pinia).use(router).mount('#app')
enableAutoPersist()
