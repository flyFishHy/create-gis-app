# OpenLayers / Vue integration

`@joinmap/ol-vue` connects the public Runtime, OL adapter and Vue UI APIs. Neither
Core nor the generic Vue UI imports OpenLayers for this integration.

```ts
import { createGISApp } from '@joinmap/gis-core'
import { createOLAdapter, createOLTools } from '@joinmap/adapter-ol'
import { createVueUI } from '@joinmap/ui-vue'
import { createOLToolsUI, OLMapStatus } from '@joinmap/ol-vue'
import 'ol/ol.css'
import '@joinmap/ui-vue/style.css'

const app = createGISApp()
app.use(createOLAdapter({ zoomControl: false }))
app.use(createOLTools())
app.use(createVueUI({
  config: { panels: [{ id: 'toolbar', visible: true }] },
  extensions: [createOLToolsUI()],
  statusComponent: OLMapStatus,
}))
```

Install the OL adapter and tools before the UI integration. `createOLToolsUI()`
registers zoom/drawing/measurement/delete/clear buttons and a result panel.
Keyboard Escape cancels the active tool, Backspace undoes its last point; these
shortcuts apply only when the app owns focus and do not intercept text editing.
Extension cleanup removes registrations and DOM listeners; results stay with the
OL tools plugin across UI remounts. Toolbar labels and result actions follow zh/en.

`OLMapStatus` supplies local pointer coordinates and a scale calculated at the
map center (0.28 mm nominal pixel), while `MapStatusPanel` stays engine-neutral.
Component unmount removes its pointer listener. Import the generic UI stylesheet
for toolbar/result panel appearance; no Demo-specific stylesheet is required.

The Basic Vue files `ol-tools-ui.ts` and `MapStatus.vue` remain compatibility
wrappers. New apps can import this package directly.
