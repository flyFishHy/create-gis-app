# @joinmap/ui-vue

Vue 3 GIS rendering with optional UI defaults and Runtime-owned business services.

```ts
const app = createGISApp()
app.use(createOLAdapter())
app.use(createVueUI({
  config: { layout: 'docked-dashboard', theme: 'light' },
  panelDefinitions: [{
    id: 'analysis', component: AnalysisPanel,
    position: 'right', defaultVisible: true,
  }],
}))
app.search.registerProvider(searchProvider)
await app.init(appConfig)
await app.mount('#app')
```

UIConfig is shared by config and appConfig.ui. Presets < UI defaults < explicit
AppConfig fields < current user state. No layout/theme/defaults/legends/searchProviders
top-level options remain. Components/callbacks stay in code; layer legend metadata
and panel state preferences are declarative JSON.

After installing createVueUI and initializing Runtime, an existing Vue application
can render `<GISWorkspace :app="app" />` instead of calling app.mount itself.
It preserves host provide/inject and uses the same Runtime lifecycle/UI state.
Configuration defaults are supplied before init through createVueUI({ config }).
Pure `Legend` accepts definitions/titles/emptyText without any Runtime injection.

Import @joinmap/ui-vue/style.css. See [API](../../doc/vue-ui-api.md), including
embedded ownership, panel registration, search cancellation and supported positions.
