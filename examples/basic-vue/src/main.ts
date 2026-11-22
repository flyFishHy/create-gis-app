import { createGISApp, parseGISAppConfig } from '@joinmap/gis-core'
import { createOLAdapter } from '@joinmap/adapter-ol'
import { createVueUI, loadWorkspaceConfig } from '@joinmap/ui-vue'
import appConfig from './appConfig.json'
import 'ol/ol.css'
import '@joinmap/ui-vue/style.css'
import './style.css'

const workspaceStorageKey = 'joinmap.basic-vue.workspace.v1'
const defaults = parseGISAppConfig(appConfig)
const saved = loadWorkspaceConfig(workspaceStorageKey, defaults)
function createApp() {
  return createGISApp({ id: 'basic-vue-example', name: 'GIS Runtime Example' })
    .use(createOLAdapter({ zoomControl: false }))
    .use(createVueUI({ workspaceStorageKey }))
}
let app = createApp()
try {
  await app.init(saved)
} catch (error) {
  if (saved === defaults) throw error
  await app.dispose()
  localStorage.removeItem(workspaceStorageKey)
  console.warn('Saved workspace could not be restored. Loading the example configuration.', error)
  app = createApp()
  await app.init(defaults)
}

await app.mount('#app')

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    void app.dispose()
  })
