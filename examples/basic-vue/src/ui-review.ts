import { createGISApp, parseGISAppConfig } from '@joinmap/gis-core'
import { createOLAdapter } from '@joinmap/adapter-ol'
import { createVueUI } from '@joinmap/ui-vue'
import config from './appConfig.json'
import 'ol/ol.css'
import '@joinmap/ui-vue/style.css'
import './style.css'

const app = createGISApp()
app.use(createOLAdapter({ zoomControl: false }))
app.use(createVueUI())
if (location.search.includes('narrow')) document.getElementById('app')!.style.width = '360px'
await app.init(parseGISAppConfig({ ...config, ui: { ...config.ui, layout: 'overlay-dashboard' } }))
await app.mount('#app')
if (import.meta.hot) import.meta.hot.dispose(() => { void app.dispose() })
