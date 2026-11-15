# Vue UI API reference

`@joinmap/ui-vue` owns Vue rendering, layout and current presentation state.
Core owns application configuration, layers/legends and search providers.

## Application entry

```ts
const app = createGISApp({ id: 'demo' })
app.use(createOLAdapter())
app.use(createVueUI())
app.search.registerProvider(searchProvider)
await app.init(appConfig)
await app.mount('#app')
```

Import `ol/ol.css` and `@joinmap/ui-vue/style.css`. Ordinary applications do not
create a Vue App themselves. AppConfig JSON can be validated with
`parseGISAppConfig(value)`; init also validates configuration.

## UI defaults and implementation extensions

```ts
app.use(createVueUI({
  config: {
    layout: 'overlay-dashboard',
    theme: { mode: 'dark', tokens: { panelWidth: '280px' } },
    locale: 'zh',
    panels: [{ id: 'legend', visible: true }],
  },
  panelDefinitions: [{
    id: 'analysis', component: AnalysisPanel,
    position: 'right', defaultVisible: true,
  }],
  extensions: [analysisExtension],
  toolbarItems: [{ id: 'save', title: 'Save', icon: 'save', onClick: save }],
}))
```

`config` uses the same Core `UIConfig` as `appConfig.ui`. Precedence is built-in
presets, UI config defaults, explicit AppConfig fields, then user interactions.
Panels merge by ID and field; theme token maps merge by key. Resolution happens
once at initialization; rendering/remounting never resets user state.

Removed plugin options: layout, theme, defaults, panels, legends, searchProviders,
kpis. Use config for serializable defaults, panelDefinitions for components, layer
legend for business legends, and app.search for providers. KPI remains an exported
component that an application can register normally. appProps, toolbarComponent,
statusComponent, toolbarItems and extensions remain implementation integration APIs.
Custom layouts are registered as `layouts: { custom: CustomLayout }` and selected
by name through UIConfig.layout; Vue components never enter JSON.

Built-in panels are registered automatically. Search, time placeholder, Layers,
Legend and toolbar are visible by default; popup is hidden. Use
`ui.panels: [{ id: 'time', visible: false }]` to disable the placeholder.
The toolbar definition renders in a dedicated layout slot, while its visibility
uses the same PanelRegistry state. Toolbar/time support top; popup supports floating.
Unsupported positions for those controls warn and fall back; unknown panel IDs
warn after extensions install.

## Embed in an existing Vue application

Initialize Runtime and install createVueUI with its defaults/extensions first.
Then render the exported component inside the host Vue tree:

```vue
<GISWorkspace :app="app" @ready="onReady" @error="onError" />
```

GISWorkspace uses the existing UI adapter, configuration and services. It calls
Runtime mount/unmount and preserves parent Vue provide/inject context; it does not
create a nested Vue application. Do not also call app.mount for this workspace.
One adapter/host can own an app at a time. Host removal detaches the map and queues
unmount without disposing Runtime. A later host reuses UI state and providers.
Runtime dispose removes its rendered UI even if the host component remains mounted.
The supplied app is stable for the component lifetime; replace the component/key
to switch Runtime instances. Config defaults are supplied before init through
createVueUI({ config }), not reapplied as reactive host props.

## Independent components

PanelShell, Tooltip, SvgIcon, GisSwitch, KpiPanel and TimeController can be used
through props/slots/events. `Legend` is a pure presentation component:

```vue
<Legend :definitions="legends" :titles="layerTitles" empty-text="暂无图例" />
```

It needs no Runtime or UI injection. LegendPanel is the Runtime-connected wrapper:
it reads visible layer legends from useAppState; it owns no business legend array.
Category, continuous, interval, image and no-data display remain supported.
FeatureDetails/PropertiesPanel use the UI context and its feature renderers; they
are connected components, not standalone data-only primitives.

## Search and legends

Provider types are exported by Core (also re-exported by UI). SearchPanel uses
app.search, observes provider changes and disables submit without providers. Its
loading/results/errors remain local; unmount cancels only its request.
Escape, outside pointer input, blur or result selection dismisses dropdown results.
Caller AbortSignals isolate queries; stale UI responses cannot replace newer ones.
Result selection calls app.map.locate. An explicit result projection is transformed
by the map adapter; omission means current map projection, not implicit WGS84.

Configure `layers[].legend`; change it through `layers.update(id, { legend })`
or remove with null. Hiding a layer hides its legend; removal removes it naturally.
The OL adapter resolves opt-in useLayerStyle for a single category item. Category
colors are otherwise preserved. LegendPanel never reads OL style metadata.

## Layout and state

Docked: left Layers/Legend sidebar, central Search/time and horizontal toolbar row,
map and compact status, right properties region. Overlay: Search/time upper-left,
Layers below, Legend lower-left, vertical toolbar right, status bottom-center,
right drawer when a right panel is visible. Above 1100px, drawer visibility keeps
the left bottom anchor stable. At 1100px and below status has its own row; at
800px and below the drawer moves to a bottom row. Bodies/toolbar scroll internally.
Only real controls receive pointer input; empty overlay space reaches the map.

PanelService owns register/show/hide/toggle/collapse/expand/setOrder/getState.
Definitions contain components; PanelConfig contains only serializable fields.
PanelHost handles shells and dimensions. Numeric dimensions become px.
See [theme tokens](vue-ui-theme-tokens.md) for width precedence and responsive caps.

Read Core state with useAppState(), which returns a readonly Vue computed ref and
unsubscribes on component removal. Panels/theme/locale contribute the existing
extensions['vue-ui'] JSON slice. State is a read model, not a writable second store.

MapStatusPanel reads zoom/projection and accepts coordinate/scale props; Docked is
a compact row, Overlay gives each item a title above its value. TimePlaceholder
is disabled and has no time/filter business state. [OL integration](ol-vue-api.md)
provides OL pointer coordinates, scale, drawing toolbar and result list.

Tooltip has no header; hover delay is 180ms, focus opens immediately. right/left/
bottom placement flips at viewport edges, and Escape/click/blur/resize/scroll closes
it. Timers/listeners are cleaned up at unmount.
