# create-gis-app

Framework-independent GIS application runtime with an official Vue UI and map
engine adapters kept in separate workspace packages.

```ts
const app = createGISApp({ id: 'demo' })
app.use(createOLAdapter())
app.use(createVueUI())
app.search.registerProvider(searchProvider)
await app.init(appConfig)
await app.mount('#app')
```

UI defaults can be supplied through `createVueUI({ config })`; explicit
`appConfig.ui` fields override them. Layer legends belong to `layers[].legend`.
Existing Vue hosts can render `GISWorkspace` instead of invoking mount themselves;
see the [UI API](doc/vue-ui-api.md) for lifecycle and ownership rules.

## Workspace

- `packages/core` — Runtime lifecycle, plugin and resource management,
  configuration validation, map/layer services, datasets, interactions, and events.
- `packages/adapter-ol` — OpenLayers 10.11 adapter with XYZ and GeoJSON layer types.
- `packages/ui-vue` — Vue 3 UI adapter with Docked and Overlay dashboard layouts.
- `packages/ol-vue` — optional OL result-list integration ([API](doc/ol-vue-api.md)).
- `doc` — Runtime and Vue UI API design documents.

## Development

Install workspace dependencies with `pnpm install`, then build all packages
with `pnpm build`. Run package type checks with `pnpm typecheck`, the unit,
component, and integration suite with `pnpm test`, or the complete quality gate
with `pnpm check`.

## Resources

- [Runtime API reference](doc/runtime-api.md)
- [Vue UI API reference](doc/vue-ui-api.md)
- [CSS theme tokens](doc/vue-ui-theme-tokens.md)
- [Compatibility and version policy](doc/compatibility.md)
- [GIS app config JSON Schema](schemas/gis-app-config.schema.json)
- [Basic Vue example](examples/basic-vue)
- [Core plugin template](templates/core-plugin)

Architecture and implementation baselines are documented in
[`doc/create-gis-app-runtime-api-design.md`](doc/create-gis-app-runtime-api-design.md)
and [`doc/create-gis-app-vue-ui-api-design.md`](doc/create-gis-app-vue-ui-api-design.md).
