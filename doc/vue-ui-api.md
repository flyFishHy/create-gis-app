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
Legend, toolbar and status are visible by default. Properties
is initially visible in Docked and hidden in Overlay. Properties opens on selection;
deselection keeps the Docked panel visible with its empty state and hides Overlay.
Closing preserves selection. Docked keeps its left rail fixed and always presented;
Properties has a close button and its visibility alone controls the right grid track.
Explicit properties.visible=false disables automatic opening, while visible=true
displays it initially. A subsequent selection can reopen a manually closed panel. Use
`ui.panels: [{ id: 'time', visible: false }]` to disable the time controller.
The toolbar definition renders in a dedicated layout slot, while its visibility
uses the same PanelRegistry state. Toolbar and time support top. Status supports bottom.
Unsupported positions for those controls warn and fall back; unknown panel IDs
warn after extensions install.

The built-in `FeaturePicker.vue` lives in the map slot in both dashboard layouts.
A single hit opens Properties through the existing selection policy. Multiple hits
open a picker beside the click with a feature name and layer title for each option.
With OpenLayers, the picker uses a native coordinate-anchored overlay. It follows
panning and is adjusted at the viewport edges without moving the map. A zoom or
rotation closes the picker. Other adapters can use the click pixel.
Choosing an option opens its Properties. Closing the picker or pressing Escape
preserves the existing selection. The previous built-in `ui.panels` entry with
ID `popup` is ignored. The exported `FeaturePopup` component remains available
for custom UIs that display committed selection in a floating details view.

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
The viewport hides the native bar. For each overflowing axis it displays a thumb
on a transparent track. Thumb size and position reflect native
scroll dimensions; dragging, track clicks and Arrow/Page/Home/End keys update the
native viewport. Wheel/touch/native programmatic scrolling remain unchanged.
The Layers and Legend panels use 3px thumbs. On devices with hover, each panel
reveals its scrollbar on hover. Dragging or keyboard focus keeps the thumb visible.
ResizeObserver and a content observer refresh geometry after layout or content changes.
Content mutations refresh immediately before paint and schedule one frame verification.
Unmount disconnects observers, cancels frames and ends drags.
Expose viewport/refresh for programmatic access. The controls overlay content, so
they do not change layout width. Forced colors uses
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
Result selection calls `app.map.locate`. When the result includes a `feature`, the
panel then calls `app.interactions.select`, opening Properties under the existing
panel policy and highlighting local vector geometry in OpenLayers. An explicit result projection is transformed
by the map adapter; omission means current map projection, not implicit WGS84.
Result suggestions and Select menus follow the dashboard panel material. They
use the elevated surface with at least 80% opacity for legibility. Browsers
without backdrop filtering use an opaque surface.
Dropdown feedback owns the scroll; its list does not create a nested scrollbar.

Configure `layers[].legend`; change it through `layers.update(id, { legend })`
or remove with null. Hiding a layer hides its legend; removal removes it naturally.
The OL adapter resolves opt-in useLayerStyle for a single category item. Category
colors are otherwise preserved. LegendPanel never reads OL style metadata.

## Layout and state

Docked: 320px left Layers/Legend sidebar, three independent Search/time/toolbar surfaces
above the map (Search and time left aligned, toolbar right aligned; narrow rows wrap),
map and compact status, right properties region. Overlay keeps 300px Layers upper-left
and Legend lower-left; Search/time start immediately to their right, while the vertical
toolbar is centered at the right edge of the remaining map workspace. Status remains
bottom-center. Properties has a separate right drawer. The left rail and drawer widths
are resolved independently. Explicit panel positions still override these defaults.
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
columns (76/128/116/184px) with icon/text titles above values, subtle dividers and
tabular monospace numbers. The bar is capped at 560px. When its content width is at most
520px, level, scale and projection share the first row; coordinates span the second row.
Coordinates are one text
value (`139.12550,26.25500`, five decimals, no degree signs or separator element).
Initially they display `--`; leaving the map preserves the last finite position,
including across status-panel remounts. The per-app UI cache uses weak references;
it adds no AppState slice or background subscriptions while the panel is hidden.
Coordinates/level/scale/projection use location/scan/scale/global SVG titles with
accessible names/tooltips. Both layouts display icons and text. All columns have bounded
overflow so pointer movement cannot resize the bar. Toolbar and panels share the
same outer panel material alongside the Header and Settings popover.
The mixin emits the prefixed property first and standard backdrop-filter last,
preserving both through the production optimizer. Overlay Header/Search/time/tools/
panels default to a 16px blur and 72% surface opacity. Frosted and solid panels
share the reference border and shadow. Liquid panels use separate light and dark
gradients, borders and shadows. Dropdowns use a more opaque surface for readability.
Docked applies the same panel finishes to its continuous outer regions. Toolbar paint belongs to the outer
scroll container; property-panel ancestors allow shadows to overflow while PanelShell
clips content to its rounded border. Control surfaces share a 2.75rem
minimum height. Typography uses the local .875rem base and derived size variables,
with system CJK fallbacks and standard 400/500/600/700 weights, without changing html.
The header settings icon opens a non-modal popover below the header. Appearance
contains theme mode, panel material, theme color and built-in layout selection.
Display language has its own group. Changes apply immediately. Built-in layout
switching keeps the header, open popover, query controls, and left panels mounted.
It reattaches the existing map and retains the Runtime view, selection, time
filter, and legend drafts and reset baseline. `ui.layout`
sets the initial layout, and `extensions['vue-ui'].layout` reports the current one.
Custom layouts keep the component registered in code.

Selected switch labels use white. Both theme mode labels use white in dark mode.
`theme.mode=system` remains supported in config. Theme color controls `colorPrimary`
and its derived accents. Overlay defaults to frosted glass. Docked defaults to
solid surfaces and applies glass to its outer regions when selected. A non-empty
`title.subtitle` displays beside `title.content` as a badge with a pulsing dot on
wider viewports. The dot stays still when reduced motion is requested.
The built-in `time` panel uses `TimeFilterPicker`. It accepts any calendar hour,
day, ISO week, month or year, including on workspaces with no map layers.
The expanded panel follows the dashboard's frosted, liquid, or solid surface.
`ui.timePicker` configures its available granularities, default mode and time zone,
time limits, and visible controls. Hide it with `ui.panels: [{ id: 'time', visible: false }]`.
Subscribe to Runtime state and read `extensions['vue-ui'].timeSelection` for the
panel's confirmed selection. Standalone usage receives the same value through
`v-model` and `@apply`. The time selection is independent of map and layer state.
The separately exported `TimeController` accepts numeric or discrete values.

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { TimePicker, type TimeSelection } from '@joinmap/ui-vue'
import '@joinmap/ui-vue/style.css'

const range = ref<TimeSelection | null>(null)
</script>

<template>
  <TimePicker v-model="range" default-mode="range" default-granularity="hour"
    default-time-zone="Asia/Shanghai" />
</template>
```

`TimePicker` and `TimeFilterPicker` are aliases. Modes are `single`, `range`,
and `custom-range`. The value includes the mode, granularity, IANA zone and
`range: { start, endExclusive }` in Unix milliseconds. The period range includes
the whole last selected unit. An exact range uses the literal end instant.
See [the time picker design and public API](timepicker.md).

Set `createVueUI({ workspaceStorageKey })` and pass
`loadWorkspaceConfig(workspaceStorageKey, defaults)` to `app.init()` to enable
browser-local saving. Settings adds JSON export and import. Import validates the
configuration and reloads the workspace. `captureWorkspaceConfig(app)` captures
theme, language, layout and the current title, visibility, opacity, order, legend
and style of layers declared in the initial configuration. The restored
configuration becomes the baseline for the new session.

Toolbar includes zoom plus known drawing/measurement/delete/clear buttons. It uses
InteractionService.hasTool/canActivateTool, not OL imports or OL state slices.
Missing capabilities hide buttons; unavailable actions are disabled. UIConfig.tools
optionally lists visible built-in IDs (including zoom-in/zoom-out); [] hides all
built-ins. Activating a known drawing or measurement tool shows a non-interactive map
hint with the click/double-click workflow and Esc shortcut; the hint follows public
AppState and disappears when the tool deactivates. Custom toolbarItems are separate. Escape cancels and Backspace undoes
inside the workspace; text inputs/contenteditable and modified keys are ignored.
Status uses the dedicated id=status panel slot and respects visible=false.
No createOLToolsUI/createPropertiesUI/OLMapStatus is needed for basic applications.
The optional [OL integration](ol-vue-api.md) adds only an advanced result-list panel.

Tooltip has no header; hover delay is 180ms, focus opens immediately. right/left/
bottom placement flips at viewport edges, and Escape/click/blur/resize/scroll closes
it. Timers/listeners are cleaned up at unmount.

LayerManager renders expandable cards ordered as visibility, title, drag handle,
crosshair location and expand button. The header shows visible root layers / total
root layers and a refresh action. Case-insensitive name filtering includes child
layers and retains their ancestors; a matching parent retains its subtree. Search
expands matching roots without changing saved expansion state or Runtime order.
Refresh clears the filter and re-reads current Runtime data, preserving visibility,
styles and order. Toggling a group applies visibility to all descendants. Child
toggles remain available when a group is hidden. A group is visible whenever any
descendant is visible. Settings contain an opacity
slider only; style/legend editing belongs to LegendPanel. 0–100% maps to LayerService.update
options.opacity 0–1 (100% is opaque).
Rapid input coalesces pending slider values; committed values are read from layer
metadata. A group slider applies a uniform value to leaf children. The unframed
readout shows a percentage for a common value and a dash when children differ.
Unsupported layers disable the slider. Existing groups keep
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
LegendEditor, submitting complete base style and legend together in one
version-checked update. Cancelling changes no Runtime state. Titles and legend
type are fixed in this editor. Category/interval colors drive map classification;
fieldless single-category swatches edit the uniform base color. More opens a
layer style dialog for vector symbols. Applying the dialog updates the draft.
External updates require reload, deletion or ID replacement blocks submission,
and failures preserve the draft. The separate properties panel still shows features.
With local workspace storage enabled, committed edits are included in the saved
workspace configuration. A click on a supported classification rule filters the
layer to that rule. Clicking it again shows all classes. The rule combines with
the time filter and applies to the map and local search.

## Inline legend cards

LegendPanel renders one card per visible layer legend. The header uses the layer
title in both modes. Viewing headers offer only Edit and Reset actions; the panel
header shows the visible legend count and Refresh. Refresh re-reads current Runtime
data while preserving unsaved edits and styles. The field row has no Metric label:
it displays legend.field as text and the localized type as plain text on the right;
editing replaces the field value with a selector. A fieldless category shows its
swatch directly. Only field-based classification shows an unmatched-values swatch.
Edit switches that card in place; other cards remain visible.
The form edits metric, grouped category values/labels or explicit interval boundaries.
Colors use native color pickers; rows can be added/deleted. Save validates and submits
top-level style and legend together. Close cancels the draft. Viewing mode offers
Reset to restore the card's first loaded definition.

LegendEditor accepts optional fields/symbol/getFieldValues props. The latter is a
lazy synchronous callback, provided by LayerEditor from the public layer capability;
standalone users can supply their own candidates. Bound categories expose typed
matching values; intervals sort ascending on save and reject invalid/overlapping
ranges. The unmatched-values color edits the base layer style. Selecting no
classification on a field-based category saves a single uniform swatch. The More
dialog offers fill opacity and outline styling for areas, width/dash/cap for lines,
and radius plus outline styling for points.
Visible layers with scalar fields can create a legend from their card. Auto
generation populates the draft with up to 12 distinct categories or up to five
equal-width numeric intervals. Save commits the generated rules. External updates
require reload; deletion or same-ID replacement cannot receive an old draft.
Independent Legend adds styles/symbols/typeLabels/defaultText/fieldLabel/
uniformText props;
it renders ranges directly using their actual boundary notation.

`GisMultiSelect` is independently usable with typed scalar `modelValue[]`,
`options: { value, label, disabled?, hint? }[]` and `update:modelValue`. It supports
search, continuous selection, clear, Escape/arrow/Enter navigation and missing
selected values. The first selected label plus +N keeps trigger width stable.
Only the first 100 search matches are rendered, with a visible count; search still
covers all supplied candidates. LegendEditor disables values assigned to other
groups. Menus escape scroll clipping, inherit theme variables, open upward when
needed, and remove global listeners on close/unmount. GisSelect's opt-in floating
mode is used by the metric selector; existing single-select behavior remains.


Docked workbench revision: Header spans the full width. Layers and Legend share one continuous left aside with a divider and independent scrolling; Properties occupies the right aside. Search/time and icon+text tools share a single center action row, with status below the center map. Docked regions use continuous surfaces with square corners. Overlay uses separate floating surfaces. The left rail stays presented without collapse/restore controls. Properties is initially visible, can be closed without clearing selection, and reopens on a new selection through PanelService. There is no separate sidebar collapse state. Toolbar overflow is measured with ResizeObserver and localized labels; trailing actions move into a keyboard-operable More menu using the same tool definitions. At 800px and below, panels stack below the map in a scrollable workspace without covering it.

Docked alignment: layer and property headers track the measured action-row height (minimum 48px). Built-in headers use SVG icons; Properties provides a close button; Layers and Legend have no sidebar collapse control. Centered icon/title/description empty states are shared by Properties, Layers and Legend. Toolbar and Search share the small typography token and 16px icons. Map grid backgrounds remain intact.

Docked surface polish: action-row horizontal padding is 16px (10px on narrow screens); Search/time controls use 10px corners and toolbar buttons 8px. More uses a three-dot SVG and localized label, hidden visually on narrow screens while retaining its accessible name. Overflow reserves the measured More-button width. The Legend title icon follows the primary color. The empty-state illustration keeps its symbol colors.


## Selective state subscriptions

useAppState() retains its whole-snapshot behavior. useAppState(snapshot => snapshot.layers)
returns a readonly computed projection and notifies Vue only when Object.is detects
a changed selected value. Prefer existing immutable branches/scalars over newly
allocated projection objects. Layer, legend, search, temporal and properties panels
select their relevant branches so a view-only change does not rebuild their content.
Map status still follows live view updates. Selectors unsubscribe at unmount.
