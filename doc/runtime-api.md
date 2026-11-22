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

The optional `title.subtitle` string supplies the Vue dashboard header badge.
Existing title configurations with `content` and `icon` remain valid.

Selection and map-view writes reject once shutdown starts; retained view facades
check lifecycle on every call. During cleanup, map reads, clearing selection and
detaching the target remain available until their resources are released. Final
snapshots remain readable after disposal; event and selection listeners are then
released and late subscriptions are inert.

Registration validates the owner scope and rolls back if binding its cleanup
fails. Map adapter registration belongs to the plugin scope, with detachment
deferred until map destruction when the engine is still in use by layer cleanup.
Map listener cleanup failures do not prevent engine destruction.

Every reported `app:error` also reaches `GISAppOptions.onError` once per emission.
Failing error listeners or callbacks cannot replace the originating failure.
Promise-returning operations still reject for callers to handle. Tool activation
failures use `TOOL_ACTIVATION_FAILED` and preserve their original cause.

## Internal modules and compatibility

`runtime/gis-app.ts` assembles services and coordinates lifecycle; plugin dependency
sorting is an internal pure function. `context/` retains the application-local
capability container; `state/` contains snapshot projection, JSON sanitization and
the internal writer. `data/` separates DataSet lifecycle from loading and processing.
`config/` separates JSON/UI validation from application and layer validation.
Public contracts are grouped under `types/`; errors live in `errors.ts`.

The package-root API is unchanged. `types.ts` remains a compatibility barrel and
currently retains the layer/legend contracts. The former internal `gis-app.ts` and
`data-service.ts` entry files also re-export their moved implementations. None of
these internal modules is a new package export or a new Manager/Registry.

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
  layerIds: ['places-layer'],
  async search({ keyword, layerId, signal }) {
    return [{ id: 'one', title: keyword, layerId,
      projection: 'EPSG:4326', coordinate: [10, 20] }]
  },
})
const results = await app.search.search({ keyword: 'place', layerId: 'places-layer', signal })
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

SearchQuery.layerId optionally scopes a query. SearchProvider.layerIds declares the
supported layer IDs (copied/frozen at registration); dispatch excludes other scoped
providers. Omission declares a general provider that must honor query.layerId when
present. SearchResult.layerId identifies its owning layer; explicitly mismatched
results are filtered out. Unscoped calls preserve aggregation across all providers.
This contract is engine/UI independent and adds no config registry or result store.

The OL adapter automatically registers one local attribute provider per GeoJSON
layer (id `ol-geojson:<layerId>`), removing it on layer disposal. It searches scalar
properties/feature IDs case-insensitively, returns at most 50 matches with projected
locations, and reads current source features after DataSet updates. It does not
implement remote full-text search for tile/WMS services. Custom providers can be
registered for those layers using the same public contract.

SearchResult can include a `feature` reference alongside its location. The built-in
GeoJSON provider uses the same reference for map clicks and search results. The
search result `id` identifies the list entry, and `feature` identifies the object
to select. A missing `projection` means the current map projection. Prefer declaring
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
and adapter order. `setOrder(ids)` accepts all registered IDs in back-to-front order
and normalizes leaf zIndex to 0..N-1, overriding earlier per-layer zIndex values.
Private adapter tool layers are not included. The default UI displays front-to-back,
moves sibling layers or entire group blocks, and never reparents a child.
Domain observer failures report app:error without undoing commits.
For GROUP, an explicit initial/update zIndex places its current leaf descendants
in a contiguous interval [zIndex, zIndex+1), preserving their relative order.
Group visibility is derived from its current descendants. Changing group visibility
updates all descendants. Changing one child can make its ancestors visible
without changing siblings. A group with no visible descendants is hidden.

Without an explicit group zIndex, child zIndex values are retained. Group metadata
reports the highest current leaf zIndex. Root drag ordering normalizes all leaves
through setOrder; Core does not store a second UI tree or drag state.

`layers.getDataLocation(id)` reads current coverage through the optional
`MapLayerHandle.getDataLocation`, returning a cloned MapLocation or undefined for
unsupported/empty/non-finite coverage. A degenerate point extent becomes a coordinate.
GeoJSON handles transform current source bounds to the current view projection;
Core merges live GROUP members only when their declared projections agree. Custom
handles in a mixed-projection group must normalize first; Core does not transform.
Hidden layers remain locatable. No bounds are cached in AppState; OL only exposes
the derived hasDataLocation boolean so empty/nonempty changes refresh controls.

```ts
const location = app.layers.getDataLocation('states')
if (location) app.map.locate(location)
const layer = app.layers.get('states')!
const expectedVersion = layer.version
await app.layers.update(layer.id, { expectedVersion, legend: nextLegend })
```

LayerInstance.version and snapshot.layers[].version increment on committed updates
and layer operations such as visibility/time filtering. Optional LayerUpdate.expectedVersion is checked inside
the serialized queue before engine changes; stale edits reject APP_INVALID_STATE.
Omission preserves normal unconditional updates. The precondition is not forwarded
to the adapter. A style/legend editor submits both in one update and retains its
draft on failure. Applications explicitly persist/export edits; init config is not
mutated or written to disk.

### Layer date/time capability

Date/time is an optional layer capability rather than a global Core clock. Adapters
can expose UTC-normalized discrete values through `MapLayerHandle.getTimeDimensions`
and apply an inclusive range through `setTimeFilter`. Applications consume the
engine-independent facade on `LayerInstance`:

```ts
const layer = app.layers.get('events')!
const dimension = layer.getTimeDimensions().find(item => item.field === 'observed_at')!
const current = dimension.values.at(-1)!
layer.setTimeFilter({ field: dimension.field, start: current, end: current })
layer.setTimeFilter(undefined) // clear
```

`LayerTimeDimension.values` and `LayerTimeFilter.start/end` are epoch milliseconds.
The OL GeoJSON adapter derives dimensions from ISO date/date-time strings and from
year/Unix timestamp values in date/time-named properties. Its filter affects map
rendering, hit detection and the built-in local search provider. Replacing the data
clears a filter when its time field disappears. Layer metadata
contains only dimension summaries and the active filter; raw values remain owned by
the layer capability so large timelines do not inflate AppState.

The standalone Vue time picker reports its own half-open query range through
`extensions['vue-ui'].timeSelection` or its component events. Layer filtering
uses this public Runtime capability explicitly when an application chooses to
apply a filter. Layer filter bounds are inclusive.

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
OL drawing and measurement results are ordinary GeoJSON features managed by
LayerService. They share selection, highlighting, and properties with other
vector features. The result controller provides
list/get/select/remove/updateGeometry/importResults/exportResults/cancel/undo/clear.
Tool results survive tool deactivation and UI remounts. createOLAdapter installs base tools internally;
there is no public createOLTools factory. Use createOLAdapter({ tools: false }) to
omit tool capability. Interactions and result layers are attached lazily as used.
useOLTools still exposes the OL-specific programmatic result controller.

Set `tools.draw.targets` with `point`, `line`, or `polygon` and
`tools.measure.targets` with `distance` or `area` to target existing inline
GeoJSON layers by ID. Each omitted key uses a default layer. Missing and
non-writable explicit targets fail on activation. The first valid result from an
unmapped tool creates its default group with the completed feature already in
the target layer. Angle measurement creates its own default layer on the first
valid result. LayerService publishes a newly added group and its descendants
together. Default layers do not modify
`app.config`. Await `importResults()` so it can create any required default layers.
Results write through the target's dataset with GeoJSON coordinates in EPSG:4326,
while the result controller keeps its map-projection format. Clear removes tool
features and labels while preserving target layers and other features.

`FeatureReference.featureKey` is an optional, opaque identity within the current
layer data. The OL adapter uses it to find the exact local vector feature even
when it has no business ID. The adapter paints a copy of the selected geometry
in a private vector layer excluded from picking and layer management. Raster
results can still be selected for properties. Their attribute-only results do
not paint a highlight. Layers can implement `MapLayerHandle.canSelectFeature`
to reject obsolete or filtered references. `LayerService` revalidates selection
after layer changes, and the OL adapter clears obsolete references on data replacement.

### Map click picking

OpenLayers sends a single click to `interactions.pickFeatures` with local hits,
the viewport pixel, and the eligible layer IDs in front-to-back order. The
click location uses the map projection and the resolution at the time of the
click. Custom layer types may implement `MapLayerHandle.identify(query)` to
return zero or more `LayerIdentifyHit` values synchronously or asynchronously.
`LayerService` supplies each result's `layerId`. An identify-capable layer
supplies its own candidates for that click, including when it returns an empty
result. Layers without `identify` participate through their native hits.

OpenLayers plugins can call `createOLLayerHandle(context, olLayer, config)` in
their layer type factory and add `handle.identify` before returning the handle.
For example, a WMS handler can use the query's coordinate, resolution and
projection to build its feature info request, pass `query.signal` to `fetch`,
and return parsed attributes. A hit may include an ID, `title`, and geometry
type, and can represent a raster value with properties alone.

Identify requests run concurrently and have a two-second deadline for each click.
A newer click, view or layer changes, tool activation, and picker unmount discard
the pending result and abort its signal. Completed coordinate-anchored choices
stay open through a pan. Zoom, rotation, projection and layer changes dismiss them.
Successful queries contribute results
even when other queries fail or time out. A successful empty pick clears selection.
An empty pick with a failed query preserves selection and reports failure to the
picker. With one candidate the Runtime selects directly. With multiple candidates,
the callback registered through `interactions.registerFeaturePicker` receives a
choice state without changing the committed selection. Without that callback,
the Runtime selects the first result. Picker states are transient and excluded
from `AppState` and workspace configuration.

`app.map.addPopupOverlay(element, { coordinate, projection })` attaches a popup
on adapters that support it and returns an idempotent cleanup function. The
projection defaults to the current map projection. OpenLayers uses a native
`Overlay`, keeps the popup inside the viewport, and leaves the camera in place.
The anchor follows panning. The popup is hidden while its anchor is outside the
viewport. Adapters without this capability return `undefined`.

InteractionService.hasTool/canActivateTool support a known basic toolbar without
a new metadata registry. ToolDefinition.mode='action' executes once and never
becomes active; delete-result and clear-results use it. Switching to an action
first deactivates the previous interaction. canActivate controls availability,
undoActiveTool calls the active definition's optional undo callback.

Map snapshots add metersPerPixel (ground resolution at the view center, null when
unsupported). MapAdapter/MapService.onPointerMove emits WGS84 longitude/latitude
or undefined on pointer leave. This local stream is excluded from AppState and
listeners are owned by consumers. Default status uses the 0.28 mm nominal pixel
for scale; OL supplies the projection-specific resolution calculation.

OL built-ins are xyz/geojson; Core supplies GROUP. `options` supports opacity.
`style` is a top-level layer field with fillColor/fillOpacity/strokeColor/strokeWidth,
lineDash/lineCap and pointRadius.
`options.style` is rejected with a migration message. The `modify-result` tool
edits the selected tool result and recalculates measurements when applicable.
Drawing and editing can snap to existing drawing and measurement results.
The OL adapter renders vertex markers and displays live and saved measurements in
map-anchored overlays. Distance measurements label the start and the accumulated
distance at each following vertex, show the live total at the pointer, and keep
the final total at the last vertex.
Angle measurements label the outside of the arc at the second vertex. Completed
result labels have a remove button and follow their layer's visibility.
Drawing and measurement tools deactivate
after committing a valid result. `deactivateTool(expectedId?)` can limit
deactivation to the matching active tool.

## Layer style and classification

LayerConfig/LayerUpdate.style sits alongside legend. It is a complete style
replacement; omitted style properties use adapter defaults. LayerInstance.style and
snapshot.layers[].style expose the effective style; the adapter owns its rendering.
MapLayerHandle.getStyle is optional. Unsupported style updates fail explicitly.
Fill opacity is a 0–1 multiplier over the color's alpha. Line dash supports solid,
dashed and dotted. Line caps support round, butt and square. A classification
rule replaces the applicable color and inherits these base style properties.

```ts
await app.layers.update('population', {
  style: { fillColor: '#94a3b8', strokeColor: '#ffffff', strokeWidth: 1 },
  legend: {
    title: 'Population', type: 'interval', field: 'population',
    ranges: [
      { id: 'low', min: 0, max: 100, color: '#dbeafe' },
      { id: 'high', min: 100, max: 200, color: '#60a5fa' },
    ],
  },
})
```

Category rules use legend.field and non-empty items[].values arrays (string, finite
number or boolean, strict typed equality). One item groups one or more matching
values under the same label/color. Duplicates within or across groups are invalid;
1 and "1" remain distinct. Legacy value input normalizes to [value]; supplying both
forms is invalid. Parsed config and runtime legends expose canonical values arrays.
Interval rules use
ranges[] with stable id/min/max/color and optional label/includeMax. They are
left-closed/right-open by default; includeMax explicitly closes an upper boundary.
Ranges must have finite min < max, unique IDs and no overlap, including closed shared
boundaries. Gaps are permitted. Unmatched and null values use the base layer style;
an optional noData color overrides null values. Rule colors replace strokeColor for
line features and fillColor for polygon/point features; other style fields inherit
the base style. Time filtering composes with classification.

`layer.supportsLegendFilter()` reports whether class filtering is available.
`layer.setLegendFilter(ruleId)` restricts rendering, hit detection and local
search to the chosen category or interval. Pass `undefined` to clear it and read
its current value with `layer.getLegendFilter()`. Rule filtering composes with
the time filter. Removing the selected rule clears its filter.

LayerInstance.getFields() reads current scalar GeoJSON properties through the
optional handle.getFields hook, returning name/type descriptors, not raw features.
LayerInstance.getFieldValues(field) delegates to an optional handle capability and
returns frozen, deduplicated scalar values from the currently loaded GeoJSON source,
including values outside the view or time filter and hidden layers. Data updates
refresh candidates on the next read. Unsupported/empty/disposed layers return [].
Candidate arrays are not cached in AppState. The OL adapter builds an enum lookup
when rules change rather than scanning every group for each rendered feature.
Fieldless legacy legends remain presentation definitions; single useLayerStyle
category entries derive their color from the base style. Continuous/image legends
retain their presentation behavior. Classification is implemented for category and
interval only. UI applies legend and style together in one version-checked update.

## Map interaction performance

OL creates default interactions explicitly with onFocusOnly=false. Pointer pan and
wheel zoom work while another control has focus; the map target retains tabindex
for keyboard accessibility. interactions:false still disables all defaults.
OL view-change notifications are coalesced once per animation frame and cancelled
on unsubscribe/disposal; direct OL view writes appear in AppState on the next frame.
Public MapService view setters still refresh snapshots synchronously.

GeoJSON temporal dimensions and geometry/data summaries are cached until Source
change (including feature edits and DataSet replacement), not until map movement.
AppState sanitizes branch values and reuses unchanged deeply frozen branches.
Identity is retained for equal layers/data/interactions/extensions, while revision
and changed map values advance. Mutable adapter/plugin inputs are still compared by
value, so in-place changes are not silently ignored; historical snapshots stay frozen.
