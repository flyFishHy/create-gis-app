import { createGISApp, parseGISAppConfig } from '@joinmap/gis-core'
import { createOLAdapter, createOLTools } from '@joinmap/adapter-ol'
import { createVueUI } from '@joinmap/ui-vue'
import { createOLToolsUI, OLMapStatus } from '@joinmap/ol-vue'
import { createPropertiesUI } from './properties-ui.js'
import appConfig from './appConfig.json'
import 'ol/ol.css'
import '@joinmap/ui-vue/style.css'
import './style.css'

const app = createGISApp({ id: 'basic-vue-example', name: 'GIS Runtime Example' })

app.use(createOLAdapter({ zoomControl: false }))
app.use(createOLTools())
app.use(createVueUI({
  extensions: [createOLToolsUI(), createPropertiesUI()],
  statusComponent: OLMapStatus,
}))
app.search.registerProvider({
  id: 'sample-states',
  async search({ keyword, signal }) {
    if (signal?.aborted || !keyword.trim()) return []
    return [{ id: 'demo-state', title: `搜索结果：${keyword}`, projection: 'EPSG:3857', coordinate: [-10700000, 4700000] }]
  },
})

await app.init(parseGISAppConfig(appConfig))

await app.mount('#app')

if (import.meta.hot) import.meta.hot.dispose(() => { void app.dispose() })
