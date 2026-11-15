import { createGISApp, parseGISAppConfig } from '@joinmap/gis-core'
import { createOLAdapter } from '@joinmap/adapter-ol'
import { createVueUI } from '@joinmap/ui-vue'
import appConfig from './appConfig.json'
import 'ol/ol.css'
import '@joinmap/ui-vue/style.css'
import './style.css'

const app = createGISApp({ id: 'basic-vue-example', name: 'GIS Runtime Example' })

app.use(createOLAdapter({ zoomControl: false }))
app.use(createVueUI())

await app.init(parseGISAppConfig(appConfig))

await app.mount('#app')

if (import.meta.hot) import.meta.hot.dispose(() => { void app.dispose() })
