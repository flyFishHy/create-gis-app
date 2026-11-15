# Optional OpenLayers result-list integration

Ordinary applications need only createOLAdapter() and createVueUI().
The adapter owns drawing/measurement, and Vue UI includes the toolbar, properties
selection behavior and map status. No createOLTools, createOLToolsUI or OLMapStatus
installation is needed.

Advanced applications can add the result-list panel:

```ts
import { createOLAdapter } from '@joinmap/adapter-ol'
import { createVueUI } from '@joinmap/ui-vue'
import { createOLResultsUI } from '@joinmap/ol-vue'

app.use(createOLAdapter())
app.use(createVueUI({ extensions: [createOLResultsUI()] }))
```

createOLResultsUI registers only an unframed bottom result list (id tool-results).
The list selects/highlights and deletes individual results through useOLTools.
It does not register a second toolbar, keyboard handlers or a status component.
Dispose removes registrations/subscriptions; results remain with the adapter
across UI remounts. tools:false is incompatible with this optional extension.

useOLTools(app) remains available from adapter-ol for result inspection, geometry
updates and import/export. Core and the standard UI never read the OL-specific
controller or extensions['ol-tools'] directly.

Import ol/ol.css and @joinmap/ui-vue/style.css for the normal app and result
appearance. Basic Vue does not depend on this optional package.
