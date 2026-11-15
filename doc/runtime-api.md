# Runtime API reference

Core is independent of Vue and OpenLayers. It owns lifecycle, configuration,
layer/data/interaction services and business search registrations.

## Application lifecycle

```ts
const app = createGISApp({ id: 'demo' })
app.use(createOLAdapter())
app.use(createVueUI())
app.search.registerProvider(searchProvider)
await app.init(appConfig)
await app.mount('#app')
await app.unmount()
await app.dispose()
```

use synchronously registers plugins in created; init normalizes configuration,
installs plugins in dependency order, runs asynchronous onInit hooks, loads data
and creates maps/layers. mount requires a UI adapter. UI unmount is reversible;
dispose is terminal/idempotent. Failed init cleans up and cannot be retried.
Registrations belong to their ResourceScope and clean up in reverse order.
Never put engine objects, Vue components or functions into JSON configuration.

## Configuration

GISAppConfig explicitly types map, layers, data, title and ui while allowing
extension fields. `parseGISAppConfig(value: unknown)` validates/clones/freezes JSON
input; init performs the same validation. JSON Schema is in
[schemas](../schemas/gis-app-config.schema.json).

UIConfig is shared between UI defaults and application configuration. It contains
layout name, theme mode or { mode, tokens, className }, locale (zh/en), panels.
Core validates serializability/shape without importing Vue. UI chooses registered
layouts/components and resolves its defaults; current user presentation state
continues to belong to the UI adapter.

## Search

```ts
const stop = app.search.registerProvider({
  id: 'places',
  async search({ keyword, signal }) {
    return [{ id: 'one', title: keyword,
      projection: 'EPSG:4326', coordinate: [10, 20] }]
  },
})
const results = await app.search.search({ keyword: 'place', signal })
stop()
```

app.search === app.context.search. Registration works before init and at runtime;
duplicate IDs fail. registerProvider accepts an optional ResourceScope and returns
an idempotent unsubscribe. listProviders/subscribe expose registration changes.
Queries have independent cancellation; starting one does not cancel another.
An aborted query rejects promptly even if a provider ignores its signal. Dispose
aborts all outstanding callers and clears registrations/listeners. Search does not
store a global result list or perform map navigation.

Partial provider failure returns successful results and reports app:error; all
providers failing rejects SEARCH_FAILED. Caller cancellation is AbortError.
No providers returns an empty result array.

SearchResult preserves id/title/subtitle/coordinate/extent/data and adds optional
projection. Omission explicitly means the current map projection. Prefer declaring
projection for external providers. app.map.locate(result) delegates projection
conversion to the adapter; OL supports transforming points/extents. Adapters without
a conversion hook only accept their own projection. Existing setCenter/fit remain.

## Layers and legends

Initial/dynamic layers use the same LayerService.add path. Updates serialize per
instance; deletion immediately forbids stale commits and waits for active updates
before releasing handles. Shutdown waits for updates before plugin/map cleanup.
Unsupported options updates fail rather than silently ignoring data. Custom
asynchronous handlers must eventually settle; Runtime cannot force arbitrary code
to terminate.

```ts
await app.layers.add({
  id: 'states', type: 'geojson', title: 'States',
  source: { type: 'url', url: '/states.json' },
  legend: { type: 'category', items: [
    { id: 'state', label: 'State', color: '#2563eb', symbol: 'fill' },
  ] },
})
await app.layers.update('states', { legend: nextLegend })
await app.layers.update('states', { legend: null })
```

LayerLegend reuses the existing LegendDefinition shape with optional id and no
configured layerId. Runtime supplies stable id/layerId and exposes layer.legend
and snapshot.layers[].legend. No separate global legend registry exists. Legend
input is cloned/validated/frozen; null in updates removes it. Hiding retains its
definition while UI filters it; removal releases it with the layer. GROUP legends
are supported through the same instance path. The optional handle.resolveLegend
hook lets adapters resolve a uniform style without UI knowing engine metadata.
OL applies useLayerStyle only for an explicitly opted-in, single category item.

Groups track child identity, not just reused IDs. Order updates synchronize list
and adapter order. Domain observer failures report app:error without undoing commits.

## Context and state

AppContextImpl has frozen service references and no app back-reference.
app.context.state provides snapshot/subscribe; no writable state API or app.state
shortcut. AppStateImpl projects layer/data metadata from owning services and stores
lifecycle/interactions internally. Snapshots are deeply frozen JSON read models,
not restore configuration; historical snapshots remain unchanged.

Fields: revision/status/map/layers/data/interactions/extensions. Layer snapshots
include current legend. Raw datasets, engine objects and pointer streams are
excluded. Subscriptions notify after commits, not immediately. Map adapters may
implement getViewState/onViewChange to report gestures and direct engine mutations.
Unsupported view fields are null. Final snapshots remain readable after disposal.

registerStateSlice(name, contributor, resources) integrates plugin JSON read models.
OL tools contribute ol-tools; Vue UI contributes vue-ui. UI services remain owners
of panel/theme/locale writes. No second writable Core UI state is introduced.

## Existing data and tools

DataService supports URL JSON/text and inline values, processors and owned datasets.
DataSet.validate rejects invalid updates before commit; subscribe observes updates.
OL GeoJSON sources follow DataSet changes. Failed layer creation releases owned
data; cleanup waits for pending creation/fetch tasks and aggregates cleanup errors.

InteractionService owns selection and one active tool. FeatureReference.source
omitted/layer means business layer; other owners manage their own invalidation.
OL tools use ol-tools, share selection with business features and provide result
list/get/select/remove/updateGeometry/importResults/exportResults/cancel/undo/clear.
Tool results survive UI remounts. The integration package connects them to Vue.

OL built-ins are xyz/geojson; Core supplies GROUP. OL options support opacity and
uniform vector styles fillColor/strokeColor/strokeWidth/pointRadius. Classification,
interactive Modify/Snap and automatic thematic legend generation remain future work.
