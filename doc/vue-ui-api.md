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

Built-in panels are registered automatically. Search, layer time controller, Layers,
Legend, toolbar and status are visible by default; popup starts hidden. Properties
is initially visible in Docked and hidden in Overlay. Properties opens on selection;
deselection keeps the Docked panel visible with its empty state and hides Overlay.
Closing preserves selection. Docked close/open fades and slides the panel while
the sidebar grid resizes, respecting reduced-motion preferences.
Explicit properties.visible=false disables automatic opening, while visible=true
displays it initially. A subsequent selection can reopen a manually closed panel. Use
`ui.panels: [{ id: 'time', visible: false }]` to disable the time controller.
The toolbar definition renders in a dedicated layout slot, while its visibility
uses the same PanelRegistry state. Toolbar/time support top; popup supports floating; status supports bottom.
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
through props/slots/events.

`ScrollArea` uses native content scrolling with custom overlaid tracks/thumbs, independently usable with
the shared style sheet and theme tokens: `<ScrollArea label="Details" style="max-height: 240px">…</ScrollArea>`.
It forwards ordinary class/style attributes, preserves slots, and is keyboard
focusable. PanelShell, search suggestions and layer options all use this component.
The viewport hides the native bar; custom vertical/horizontal controls appear only
for overflow and fade in on hover/focus/drag. Thumb size/position reflect native
scroll dimensions; dragging, track clicks and Arrow/Page/Home/End keys update the
native viewport. Wheel/touch/native programmatic scrolling remain unchanged.
ResizeObserver and a frame-coalesced content observer refresh geometry after layout
or content changes; unmount disconnects observers, cancels frames and ends drags.
Expose viewport/refresh for programmatic access. The controls overlay content, so
they do not change layout width. Touch keeps visible controls; forced colors uses
the accessible native scrollbar. No scrolling state is added to Runtime.

`Legend` is a pure presentation component:

```vue
<Legend :definitions="legends" :titles="layerTitles" empty-text="暂无图例" />
```

It needs no Runtime or UI injection. LegendPanel is the Runtime-connected wrapper:
it reads visible layer legends from useAppState; it owns no business legend array.
Category, continuous, interval, image and no-data display remain supported.
`Legend` also exposes a `group-actions` slot receiving layerId. The built-in wrapper
uses it for its edit button; standalone consumers own their own actions.
`LegendEditor` is an independent draft form, with initial `legend`, optional
`layerStyle` (UniformLayerStyle), title/labels/saving/error props and submit/cancel
events. submit carries LegendEditValue `{ legend: LayerLegend | null, style? }`.
It copies initial values, validates colors/sizes, and does not access Runtime or
mutate props. Remount/key the form to reload initial values. Null removes the legend.
FeatureDetails/PropertiesPanel use the UI context and its feature renderers; they
are connected components, not standalone data-only primitives.

## Search and legends

Provider types are exported by Core (also re-exported by UI). SearchPanel uses
app.search, observes provider changes and disables submit without providers. Its
loading/results/errors remain local; unmount cancels only its request.
The joined select/input uses Runtime layer titles (initially appConfig.layers),
excluding groups and layers unsupported by registered providers. It passes layerId
with the query; changing/removing the chosen layer cancels and clears old results.
The internal GisSelect uses theme tokens for its popup, selected/active states and
scrollbar. It supports arrow/Home/End navigation, Enter/Space selection, typeahead,
Escape/Tab/outside dismissal, and combobox/listbox ARIA. Focus remains on the trigger.
Only keyword-input focus can restore search results; opening the layer selector
dismisses them. Layer options and result suggestions never open together.
General providers without layerIds must honor query.layerId. With no configured
layers, a general provider can still be used by a standalone Runtime-backed panel.
GeoJSON layers provide built-in local attribute search through the OL adapter;
other sources need their own providers and are not advertised as searchable by default.
Escape, outside pointer input, blur or result selection dismisses dropdown results.
Caller AbortSignals isolate queries; stale UI responses cannot replace newer ones.
Result selection calls app.map.locate. An explicit result projection is transformed
by the map adapter; omission means current map projection, not implicit WGS84.
Result suggestions and Select menus share an 88% elevated-theme glass surface with
28px backdrop blur, highlight and border. This keeps glass translucency while
blurring underlying text. Unsupported backdrop-filter falls back to opaque.
Dropdown feedback owns the scroll; its list does not create a nested scrollbar.

Configure `layers[].legend`; change it through `layers.update(id, { legend })`
or remove with null. Hiding a layer hides its legend; removal removes it naturally.
The OL adapter resolves opt-in useLayerStyle for a single category item. Category
colors are otherwise preserved. LegendPanel never reads OL style metadata.

## Layout and state

Docked: left Layers/Legend sidebar, three independent Search/time/toolbar surfaces
above the map (Search and time left aligned, toolbar right aligned; narrow rows wrap),
map and compact status, right properties region. Overlay: Search/time upper-left,
with the same left edge as the toolbar (no toolbar-width indentation),
vertical toolbar centered on the left (tooltips open right), Layers upper-right,
Legend lower-right, status bottom-center. Properties has a separate right drawer;
opening it shifts the Layers/Legend rail left with a grid transition, preserving
the Legend bottom anchor and mounted panel state. The rail and drawer widths are
resolved independently. Explicit panel positions still override these defaults.
At 1100px and below status has its own row. At 900px and below Properties stays
on the right and temporarily hides the rail because both columns cannot fit;
closing it restores the same rail, without changing panel visibility state.
Bodies/toolbar scroll internally; reduced-motion preferences disable transitions.
Only real controls receive pointer input; empty overlay space reaches the map.

PanelService owns register/show/hide/toggle/collapse/expand/setOrder/getState.
Definitions contain components; PanelConfig contains only serializable fields.
PanelHost handles shells and dimensions. Numeric dimensions become px.
See [theme tokens](vue-ui-theme-tokens.md) for width precedence and responsive caps.

Read Core state with useAppState(), which returns a readonly Vue computed ref and
unsubscribes on component removal. Panels/theme/locale contribute the existing
extensions['vue-ui'] JSON slice. State is a read model, not a writable second store.

MapStatusPanel uses Core pointer subscription and metersPerPixel from the view
snapshot to display longitude/latitude/zoom/projection/scale automatically. Optional
coordinate/scale props still override its values. Hiding status or unmounting removes
the pointer subscription; high-frequency pointer data never enters AppState.
Longitude/latitude share one cell. The order is level, scale, projection, coordinates.
Docked is a compact row with left-aligned coordinates; Overlay uses four fixed
columns (72/116/104/156px) with icon/text titles above values, subtle dividers and
tabular numbers. The bar is capped at 500px and uses two equal columns when its
content width is at most 460px. Coordinates are one text
value (`139.12550,26.25500`, five decimals, no degree signs or separator element).
Initially they display `--`; leaving the map preserves the last finite position,
including across status-panel remounts. The per-app UI cache uses weak references;
it adds no AppState slice or background subscriptions while the panel is hidden.
Coordinates/level/scale/projection use location/scan/scale/global SVG titles with
accessible names/tooltips. Both layouts display icons and text. All columns have bounded
overflow so pointer movement cannot resize the bar. Toolbar and panels share the
same Overlay glass mixin; later background shorthands must not override it.
The header offers Light/Dark only; theme.mode=system remains supported in config.
The built-in LayerTimePanel reads optional date/time dimensions from public layer
capabilities. It selects the latest value initially, lets users choose among
layer/field dimensions, move along discrete values, and applies an exact-time layer
filter or restore all times. With no capable layer it shows a disabled empty state. The independent
TimeController remains usable with numeric min/max props or a discrete `values`
array; it has no OpenLayers dependency.

Toolbar includes zoom plus known drawing/measurement/delete/clear buttons. It uses
InteractionService.hasTool/canActivateTool, not OL imports or OL state slices.
Missing capabilities hide buttons; unavailable actions are disabled. UIConfig.tools
optionally lists visible built-in IDs (including zoom-in/zoom-out); [] hides all
built-ins. Custom toolbarItems are separate. Escape cancels and Backspace undoes
inside the workspace; text inputs/contenteditable and modified keys are ignored.
Status uses the dedicated id=status panel slot and respects visible=false.
No createOLToolsUI/createPropertiesUI/OLMapStatus is needed for basic applications.
The optional [OL integration](ol-vue-api.md) adds only an advanced result-list panel.

Tooltip has no header; hover delay is 180ms, focus opens immediately. right/left/
bottom placement flips at viewport edges, and Escape/click/blur/resize/scroll closes
it. Timers/listeners are cleaned up at unmount.

LayerManager renders expandable cards with visibility and a send-icon location
button. Status, removal and ID/type are not shown. Settings contain an opacity
slider only; style/legend editing belongs to LegendPanel. 0–100% maps to LayerService.update
options.opacity 0–1 (100% is opaque).
Rapid input coalesces pending slider values; committed values are read from layer
metadata. A group slider applies a uniform value to leaf children and shows Mixed
when children differ; unsupported layers disable the slider. Existing groups keep
children inside their parent's gis-ui-layer-settings when expanded. Child rows
show only visibility and name, with no settings/opacity/location/drag controls.
Nested groups follow the same visibility-only presentation. The parent's opacity
control remains a batch update for all leaf descendants. Its icon, range and
percentage sit on one horizontal line; the visible text label is omitted while
the accessible input label is retained. Location
uses layers.getDataLocation then map.locate, with empty/unsupported controls disabled.
GeoJSON and existing group coverage are supported. A point preserves zoom; OL fits
areas with padding and a zoom cap. See [location contract](layer-location-design.md).

The list shows front-to-back order, honoring current zIndex before collection order.
Only outermost rows have grip-vertical drag handles. Dropping above/below another
root reorders whole subtrees, without reparenting children. Up/Down on a focused
handle provides keyboard ordering. Group zIndex positions its leaf block while
preserving relative child order; larger zIndex values appear higher in the list.
An explicit move uses the existing Runtime setOrder and normalizes leaf zIndex.
Keyed root rows use a TransitionGroup for 240ms position transitions after sorting;
drag opacity and insertion highlights transition separately without changing row
height. The system reduced-motion preference disables these movements.

PropertiesPanel includes a content heading resolved from the selected runtime
layer title (initially appConfig.layers[].title, including nested layers). Renaming
updates it; external/tool selections fall back to layerId, and empty selection
has no heading. This remains outside custom feature renderers.

Each Legend group opens the connected LayerEditor within the legend panel.
LayerManager has no legend/style editor entry. LayerEditor wraps the independent
LegendEditor. Uniform map fill/stroke/
width/radius, legend title, labels, standalone swatches, existing-item order and
legend presence can be edited. Opt-in single-category useLayerStyle derives its
swatch from the map style; the editor disables that derived color field. Other
legend swatches/stops are presentation-only, not classified render rules or filters.
Image legends only offer title/presence edits. Applying sends the complete style
plus legend in one version-checked update; cancelling changes no Runtime state.
External updates require reload, deletion or ID replacement blocks submission,
and failures preserve the draft. The separate properties panel still shows features.
Runtime edits do not automatically save appConfig.json. Classification/filtering
and remote-style editing remain separate future capabilities.

## Inline legend cards

LegendPanel renders one card per visible layer legend. Each card displays its title,
localized category/interval badge, geometry-appropriate swatches (line, fill, point)
and the default color. Edit switches that card in place; other cards remain visible.
The form edits title, type, field and category values/labels or interval boundaries.
Colors use native color pickers; rows can be added/deleted. Save validates and submits
top-level style and legend together; reset restores the current edit baseline; close
cancels. In viewing mode reset restores the card's first loaded definition and close
hides it locally; Show closed legends restores these cards without changing layers.

LegendEditor accepts optional fields/symbol props. Bound categories expose typed
matching values; intervals sort ascending on save and reject invalid/overlapping
ranges. Default color edits the base layer style. A fieldless single category edits
the uniform style; multiple categories require a field. More is a disabled placeholder
for future polygon borders / line settings. No advanced dialog is implemented.
External updates require reload; deletion or same-ID replacement cannot receive an
old draft. Independent Legend adds styles/symbols/typeLabels/defaultText props;
it renders ranges directly using their actual boundary notation.
