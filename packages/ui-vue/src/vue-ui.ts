import { createApp, nextTick, watch, type App as VueApp, type Component } from 'vue'
import type { GISApp, GISPlugin, ResourceScope, UIAdapter, JsonValue } from '@joinmap/gis-core'
import GISUIRoot from './GISUIRoot.vue'
import './styles.scss'
import type { GISUIContext, ThemeOptions, VueUIOptions, VueUIPlugin } from './types.js'
import { resolveUIConfig } from './config.js'
import { PanelRegistry } from './panels/panel-registry.js'
import { ToolbarServiceImpl } from './services/toolbar-service.js'
import { ThemeServiceImpl } from './services/theme-service.js'
import { LocaleServiceImpl } from './services/locale-service.js'
import { FeatureRendererServiceImpl } from './services/feature-renderer-service.js'
import SearchPanel from './panels/SearchPanel.vue'
import LegendPanel from './panels/LegendPanel.vue'
import LayerManagerPanel from './panels/LayerManagerPanel.vue'
import Toolbar from './panels/Toolbar.vue'
import FeaturePopup from './panels/FeaturePopup.vue'
import LayerTimePanel from './panels/LayerTimePanel.vue'
import MapStatusPanel from './panels/MapStatusPanel.vue'
import PropertiesPanel from './panels/PropertiesPanel.vue'
import { registerBuiltinToolbar } from './builtin-toolbar.js'

const adapters = new WeakMap<GISApp, VueUIAdapter>()
export function getVueUIAdapter(app: GISApp): VueUIAdapter {
  const adapter = adapters.get(app)
  if (!adapter) throw new Error('Initialize createVueUI() before rendering GISWorkspace.')
  return adapter
}

class VueUIAdapter implements UIAdapter {
  private vueApp?: VueApp
  private disposed = false
  private mounted = false
  private host?: { render: (visible: boolean) => void; target: () => Element | undefined }
  private readonly panels: PanelRegistry
  private readonly toolbar = new ToolbarServiceImpl()
  private readonly theme: ThemeServiceImpl
  private readonly locale: LocaleServiceImpl
  private readonly featureRenderers = new FeatureRendererServiceImpl()
  private readonly extensionCleanups: Array<() => void> = []
  readonly context: GISUIContext
  readonly layout: string | Component
  constructor(private readonly runtime: GISApp, private readonly options: VueUIOptions) {
    const config = resolveUIConfig(options.config, runtime.config?.ui)
    this.theme = new ThemeServiceImpl(config.theme as ThemeOptions)
    this.locale = new LocaleServiceImpl(config.locale)
    const layout = config.layout!
    this.layout = options.layouts?.[layout] ?? layout
    if (typeof this.layout === 'string' && !['docked-dashboard', 'overlay-dashboard'].includes(this.layout)) throw new Error(`Unknown UI layout "${layout}". Register its component in layouts.`)
    const panels = (config.panels ?? []).map(panel => {
      const supported = panel.id === 'toolbar' || panel.id === 'time' ? 'top' : panel.id === 'popup' ? 'floating' : panel.id === 'status' ? 'bottom' : undefined
      if (supported && panel.position && panel.position !== supported) {
        console.warn(`[gis-ui-vue] ${panel.id} only supports position "${supported}"; using that position.`)
        return { ...panel, position: supported as 'top' | 'floating' | 'bottom' }
      }
      return panel
    })
    this.panels = new PanelRegistry(panels)
    registerBuiltinToolbar(runtime, this.toolbar, config.tools)
    for (const item of options.toolbarItems ?? []) this.toolbar.register(item)
    this.context = Object.freeze({
      app: runtime, panels: this.panels, search: runtime.search, toolbar: this.toolbar,
      theme: this.theme, locale: this.locale, featureRenderers: this.featureRenderers,
      toolbarComponent: options.toolbarComponent, statusComponent: options.statusComponent,
    })
    this.registerDefaultPanels()
    for (const panel of options.panelDefinitions ?? []) this.panels.register(panel)
    const applicationProperties = runtime.config?.ui?.panels?.find(panel => panel.id === 'properties')
    const defaultProperties = options.config?.panels?.find(panel => panel.id === 'properties')
    const autoOpen = (applicationProperties?.visible ?? defaultProperties?.visible) !== false
    const syncProperties = () => {
      if (runtime.interactions.getSelection()) { if (autoOpen) this.panels.show('properties') }
      else if (config.layout !== 'docked-dashboard') this.panels.hide('properties')
    }
    // Initial rendering and subsequent selections use the same policy; closing preserves selection.
    if (runtime.interactions.getSelection()) syncProperties()
    this.extensionCleanups.push(runtime.interactions.onSelect(syncProperties))
  }
  get rootProps() { return { runtime: this.runtime, ui: this.context, layout: this.layout, appProps: this.options.appProps ?? {} } }
  bindHost(render: (visible: boolean) => void, target: () => Element | undefined): () => void {
    if (this.disposed || this.host || this.mounted) throw new Error('A workspace already owns this Runtime UI.')
    const host = { render, target }
    this.host = host
    return () => { if (this.host === host) this.host = undefined }
  }
  installExtensions(extensions: readonly VueUIPlugin[]): void {
    const names = new Set<string>()
    for (const extension of extensions) {
      if (!extension.name.trim() || names.has(extension.name)) throw new Error(`Invalid or duplicate UI extension "${extension.name}".`)
      names.add(extension.name)
      const cleanup = extension.install(this.context)
      if (cleanup) this.extensionCleanups.push(cleanup)
    }
    this.panels.warnForUnknownConfiguredPanels()
  }
  registerState(resources: ResourceScope): void {
    this.runtime.registerStateSlice('vue-ui', {
      snapshot: () => JSON.parse(JSON.stringify({ panels: this.panels.states.value, theme: this.theme.get(), locale: this.locale.get() })) as JsonValue,
      subscribe: listener => watch([() => this.panels.states.value, () => this.theme.get(), () => this.locale.get()], listener, { flush: 'sync' }),
    }, resources)
  }
  async mount(target: Element | string): Promise<void> {
    if (this.disposed || this.mounted) throw new Error('Vue UI is disposed or already mounted.')
    const element = resolveTarget(target)
    if (this.host && this.host.target() !== element) throw new Error('This Runtime is bound to a GISWorkspace host target.')
    this.mounted = true
    try {
      if (this.host) { this.host.render(true); await nextTick(); return }
      this.vueApp = createApp(GISUIRoot, this.rootProps)
      this.vueApp.mount(element)
    } catch (cause) { await this.unmount(); throw cause }
  }
  async unmount(): Promise<void> {
    if (!this.mounted) return
    this.mounted = false
    const vueApp = this.vueApp; this.vueApp = undefined
    if (vueApp) vueApp.unmount()
    if (this.host) { this.host.render(false); await nextTick() }
    if (this.runtime.map.isReady) this.runtime.map.setTarget(undefined)
  }
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const errors: unknown[] = []
    try { await this.unmount() } catch (error) { errors.push(error) }
    for (const cleanup of this.extensionCleanups.splice(0).reverse()) {
      try { cleanup() } catch (error) { errors.push(error) }
    }
    this.host = undefined
    this.panels.clear(); this.toolbar.clear(); this.theme.clear(); this.locale.clear(); this.featureRenderers.clear()
    adapters.delete(this.runtime)
    if (errors.length) throw new AggregateError(errors, 'Vue UI disposal failed.')
  }
  private registerDefaultPanels(): void {
    this.panels.register({ id: 'search', title: 'panel.search', component: SearchPanel, position: 'top', defaultVisible: true, collapsible: false, closable: false, unframed: true, props: { dropdown: true } })
    this.panels.register({ id: 'time', component: LayerTimePanel, position: 'top', unframed: true })
    this.panels.register({ id: 'layer-manager', title: 'panel.layers', component: LayerManagerPanel, position: 'left', defaultVisible: true, collapsible: false, closable: false })
    this.panels.register({ id: 'legend', title: 'panel.legend', component: LegendPanel, position: 'left', defaultVisible: true, collapsible: false, closable: false })
    this.panels.register({ id: 'toolbar', component: this.options.toolbarComponent ?? Toolbar, position: 'top', unframed: true, props: { tooltipPlacement: this.layout === 'overlay-dashboard' ? 'left' : 'bottom' } })
    this.panels.register({ id: 'popup', component: FeaturePopup, position: 'floating', unframed: true })
    if (!this.options.panelDefinitions?.some(panel => panel.id === 'properties')) this.panels.register({ id: 'properties', title: 'panel.properties', component: PropertiesPanel, position: 'right', defaultVisible: false, collapsible: false, closable: true })
    this.panels.register({ id: 'status', component: this.options.statusComponent ?? MapStatusPanel, position: 'bottom', unframed: true })
  }
}

export function createVueUI(options: VueUIOptions = {}): GISPlugin<VueUIOptions> {
  return {
    name: 'gis-vue-ui',
    install(runtime, pluginOptions, resources) {
      const resolvedOptions = pluginOptions ?? options
      const adapter = new VueUIAdapter(runtime, resolvedOptions)
      runtime.registerUIAdapter(adapter, resources)
      adapters.set(runtime, adapter)
      adapter.installExtensions(resolvedOptions.extensions ?? [])
      adapter.registerState(resources)
    },
  }
}
function resolveTarget(target: Element | string): Element {
  if (typeof target !== 'string') {
    if (!target || target.nodeType !== 1) throw new Error('Vue UI mount target must be a DOM Element.')
    return target
  }
  if (typeof document === 'undefined') throw new Error('Vue UI can only mount in a browser environment.')
  const element = document.querySelector(target)
  if (!element) throw new Error(`Vue UI mount target "${target}" was not found.`)
  return element
}
