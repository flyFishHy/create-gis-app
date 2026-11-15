import { normalizeConfig } from './config.js'
import { ResourceScopeImpl } from './resource-scope.js'
import { LayerServiceImpl } from './layer-service.js'
import { MapServiceImpl } from './map-service.js'
import { DataServiceImpl } from './data-service.js'
import { EventServiceImpl } from './event-service.js'
import { InteractionServiceImpl } from './interaction-service.js'
import { SearchServiceImpl } from './search-service.js'
import { GISRuntimeError } from './types.js'
import { AppContextImpl } from './context/app-context.js'
import { AppStateImpl, stateValue } from './state/app-state.js'
import type { StateContributor, JsonValue } from './types.js'
import type {
  AppContext,
  AppStatus,
  GISApp,
  GISAppConfig,
  GISAppOptions,
  DataProcessor,
  DataSourceConfig,
  DataService,
  EventService,
  InteractionService,
  LayerConfig,
  LayerService,
  LayerTypeDefinition,
  MapAdapter,
  MapConfig,
  MapService,
  GISPlugin,
  PluginInstance,
  ResourceScope,
  ToolDefinition,
  UIAdapter,
} from './types.js'

interface PluginRecord {
  readonly plugin: GISPlugin<unknown>
  readonly options: unknown
  readonly resources: ResourceScopeImpl
  installed: boolean
}

export function createGISApp(options: GISAppOptions = {}): GISApp {
  return new GISAppImpl(options)
}

class GISAppImpl implements GISApp {
  readonly id: string
  readonly name?: string
  readonly context: AppContext
  readonly map: MapService
  readonly layers: LayerService
  readonly data: DataService
  readonly interactions: InteractionService
  readonly events: EventService
  readonly search: SearchServiceImpl
  readonly #state: AppStateImpl
  private readonly initializeContextConfig: (config: Readonly<GISAppConfig>) => void
  private get currentStatus(): AppStatus { return this.#state.status }
  private set currentStatus(status: AppStatus) { this.#state.setStatus(status) }
  private readonly resources = new ResourceScopeImpl()
  private readonly mapResources = new ResourceScopeImpl()
  private readonly plugins = new Map<string, PluginRecord>()
  private readonly pluginInstances = new WeakSet<object>()
  private readonly installationOrder: PluginRecord[] = []
  private readonly options: GISAppOptions
  private uiAdapter?: UIAdapter
  private operationQueue: Promise<void> = Promise.resolve()
  private disposePromise?: Promise<void>

  constructor(options: GISAppOptions) {
    this.options = options
    this.id = options.id ?? createId()
    this.name = options.name
    this.events = new EventServiceImpl()
    this.search = new SearchServiceImpl(() => this.status, this.events)
    this.#state = new AppStateImpl(this.events)
    this.map = new MapServiceImpl(this.#state)
    let context: AppContext
    const dependencies = { state: this.#state, context: () => context }
    this.layers = new LayerServiceImpl(this.map, dependencies)
    this.data = new DataServiceImpl(dependencies)
    this.interactions = new InteractionServiceImpl(dependencies, this.events)
    const assembly = AppContextImpl.create({ map: this.map, layers: this.layers, data: this.data,
      interactions: this.interactions, search: this.search, events: this.events, resources: this.resources, state: this.#state.view })
    this.context = context = assembly.context
    this.initializeContextConfig = assembly.initializeConfig
    const map = this.map as MapServiceImpl
    const layers = this.layers
    const data = this.data as DataServiceImpl
    const events = this.events
    this.#state.connect(() => ({
      map: map.snapshot(),
      layers: layers.list().map(layer => ({ id: layer.id, type: layer.type, title: layer.title ?? null,
        visible: layer.visible, status: layer.status, legend: layer.legend ?? null, metadata: stateValue(layer.getMetadata()) as Record<string, JsonValue> })),
      data: data.snapshot(),
    }))
    this.resources.add(() => data.clear())
    const unsubscribeLayerEvents = this.layers.subscribe((event) => {
      if (!event.id) return
      if (event.type === 'add') events.emit('layer:added', { layerId: event.id })
      else if (event.type === 'remove') events.emit('layer:removed', { layerId: event.id })
      else if (event.type === 'visibility') events.emit('layer:visibility-changed', { layerId: event.id, visible: event.visible ?? true })
      else if (event.type === 'update') events.emit('layer:updated', { layerId: event.id })
    })
    this.resources.add(unsubscribeLayerEvents)
  }

  get status(): AppStatus {
    return this.currentStatus
  }

  get config(): Readonly<GISAppConfig> | undefined {
    return this.context.config
  }

  registerStateSlice(name: string, contributor: StateContributor, resources: ResourceScope): void {
    if (!['initializing', 'ready', 'mounted', 'unmounted'].includes(this.status)) this.assertStatus('initializing', 'register state slice')
    if (resources.disposed) throw new Error('Cannot register state slice in a disposed scope.')
    resources.add(this.#state.register(name, contributor))
  }

  use<Options>(plugin: GISPlugin<Options>, options?: Options): this {
    this.assertStatus('created', 'use plugins')
    if (!plugin.name?.trim()) {
      throw new GISRuntimeError({
        code: 'PLUGIN_INSTALL_FAILED',
        message: 'Plugin name must be a non-empty string.',
        stage: 'plugin-registration',
      })
    }
    if (this.plugins.has(plugin.name)) {
      throw new GISRuntimeError({
        code: 'PLUGIN_DUPLICATE',
        message: `Plugin "${plugin.name}" is already registered.`,
        stage: 'plugin-registration',
      })
    }
    if (this.pluginInstances.has(plugin)) {
      throw new GISRuntimeError({
        code: 'PLUGIN_DUPLICATE',
        message: `The plugin instance "${plugin.name}" is already registered.`,
        stage: 'plugin-registration',
      })
    }

    const record: PluginRecord = {
      plugin: plugin as unknown as GISPlugin<unknown>,
      options,
      resources: new ResourceScopeImpl(),
      installed: false,
    }
    this.pluginInstances.add(plugin)
    this.plugins.set(plugin.name, record)
    return this
  }

  init(config: GISAppConfig): Promise<void> {
    return this.enqueue(async () => {
      this.assertStatus('created', 'initialize the app')
      this.currentStatus = 'initializing'
      let stage = 'config-validation'

      try {
        this.initializeContextConfig(normalizeConfig(config))
        stage = 'plugin-validation'
        const orderedPlugins = this.resolvePluginOrder()

        stage = 'plugin-install'
        for (const record of orderedPlugins) {
          this.installationOrder.push(record)
          record.plugin.install(this, record.options, record.resources)
          record.installed = true
        }

        stage = 'plugin-initialization'
        for (const record of orderedPlugins) {
          await record.plugin.onInit?.(this, record.options)
        }

        const configuredData = this.config?.data
        if (configuredData && typeof configuredData === 'object' && !Array.isArray(configuredData)) {
          stage = 'data-initialization'
          for (const [id, source] of Object.entries(configuredData)) {
            await this.data.load(source as DataSourceConfig, { id })
          }
        }
        const mapConfig = this.config?.map as MapConfig | undefined
        const initialLayers = (this.config?.layers ?? []) as readonly LayerConfig[]
        if (mapConfig || initialLayers.length > 0 || this.hasMapAdapter()) {
          stage = 'map-create'
          await (this.map as MapServiceImpl).create(mapConfig ?? {})
          this.mapResources.add(() => (this.map as MapServiceImpl).destroy())
          this.mapResources.add(() => this.layers.clear())
          stage = 'initial-layer-create'
          for (const layer of initialLayers) await this.layers.add(layer)
        }

        this.currentStatus = 'ready'
        this.events.emit('app:ready', { appId: this.id })
      } catch (cause) {
        this.currentStatus = 'error'
        try { await this.interactions.deactivateTool() } catch { /* preserve initialization failure */ }
        const cleanupErrors = await this.cleanupResources()
        this.currentStatus = 'error'
        const error = cause instanceof GISRuntimeError
          ? new GISRuntimeError({
              code: cause.code,
              message: cause.message,
              stage: cause.stage ?? stage,
              detail: cause.detail,
              cause: cause.cause ?? cause,
              cleanupErrors: [...(cause.cleanupErrors ?? []), ...cleanupErrors],
            })
          : new GISRuntimeError({
              code: 'APP_INITIALIZATION_FAILED',
              message: `Application initialization failed during ${stage}.`,
              stage,
              cause,
              cleanupErrors,
            })
        this.reportError(error)
        throw error
      }
    })
  }

  mount(target: Element | string): Promise<void> {
    return this.enqueue(async () => {
      if (this.currentStatus !== 'unmounted') this.assertStatus('ready', 'mount the app')
      if (!this.uiAdapter) {
        throw new GISRuntimeError({
          code: 'UI_ADAPTER_MISSING',
          message: 'No UI Adapter is registered for this app.',
          stage: 'mount',
        })
      }
      try {
        await this.uiAdapter.mount(target)
        this.currentStatus = 'mounted'
      } catch (cause) {
        try {
          await this.uiAdapter.unmount()
        } catch (cleanupError) {
          const error = new GISRuntimeError({
            code: 'APP_INITIALIZATION_FAILED',
            message: 'UI mount failed and its cleanup also failed.',
            stage: 'mount',
            cause,
            cleanupErrors: [cleanupError],
          })
          this.reportError(error)
          throw error
        }
        throw cause
      }
    })
  }

  unmount(): Promise<void> {
    return this.enqueue(async () => {
      this.assertStatus('mounted', 'unmount the app')
      await this.uiAdapter?.unmount()
      this.currentStatus = 'unmounted'
    })
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.disposePromise = this.enqueue(async () => {
      if (this.currentStatus === 'disposed') return
      this.currentStatus = 'disposing'
      const errors: unknown[] = []

      if (this.uiAdapter) {
        try {
          await this.uiAdapter.unmount()
        } catch (error) {
          errors.push(error)
        }
      }

      try {
        await this.interactions.deactivateTool()
      } catch (error) {
        errors.push(error)
      }

      errors.push(...await this.cleanupResources())
      if (this.interactions.getSelection()) this.interactions.clearSelection()
      this.currentStatus = 'disposed'
      this.#state.close()

      if (errors.length > 0) {
        const error = new GISRuntimeError({
          code: 'APP_DISPOSE_FAILED',
          message: `${errors.length} resource cleanup operation(s) failed during app disposal.`,
          stage: 'dispose',
          cleanupErrors: errors,
        })
        this.reportError(error)
        throw error
      }
    })
    return this.disposePromise
  }

  getPlugin(name: string): PluginInstance | undefined {
    const record = this.plugins.get(name)
    if (!record) return undefined
    return { name: record.plugin.name, version: record.plugin.version }
  }

  registerUIAdapter(adapter: UIAdapter, resources: ResourceScope): void {
    if (this.currentStatus !== 'initializing') {
      throw new GISRuntimeError({
        code: 'APP_INVALID_STATE',
        message: 'UI Adapter registration is only allowed during plugin installation.',
        stage: 'plugin-install',
      })
    }
    if (this.uiAdapter) {
      throw new GISRuntimeError({
        code: 'PLUGIN_DUPLICATE',
        message: 'Only one UI Adapter can be registered per app.',
        stage: 'plugin-install',
      })
    }
    this.uiAdapter = adapter
    resources.add(async () => {
      try {
        await adapter.dispose()
      } finally {
        if (this.uiAdapter === adapter) this.uiAdapter = undefined
      }
    })
  }

  registerMapAdapter(adapter: MapAdapter, resources: ResourceScope): void {
    if (this.currentStatus !== 'initializing') {
      throw new GISRuntimeError({
        code: 'APP_INVALID_STATE',
        message: 'Map Adapter registration is only allowed during plugin installation.',
        stage: 'plugin-install',
      })
    }
    ;(this.map as MapServiceImpl).registerAdapter(adapter)
    const map = this.map as MapServiceImpl
    this.resources.add(() => map.unregisterAdapter(adapter))
  }

  registerLayerType(type: string, definition: LayerTypeDefinition, resources: ResourceScope): void {
    if (this.currentStatus !== 'initializing') {
      throw new GISRuntimeError({
        code: 'APP_INVALID_STATE',
        message: 'Layer types can only be registered during plugin installation.',
        stage: 'plugin-install',
      })
    }
    ;(this.layers as LayerServiceImpl).registerType(type, definition)
    resources.add(() => (this.layers as LayerServiceImpl).unregisterType(type, definition))
  }

  registerDataProcessor<Input, Output>(name: string, processor: DataProcessor<Input, Output>, resources: ResourceScope): void {
    if (this.currentStatus !== 'initializing') {
      throw new GISRuntimeError({ code: 'APP_INVALID_STATE', message: 'Data processors can only be registered during plugin installation.', stage: 'plugin-install' })
    }
    ;(this.data as DataServiceImpl).registerProcessorResource(name, processor, resources)
  }

  registerTool(id: string, definition: ToolDefinition, resources: ResourceScope): void {
    if (this.currentStatus !== 'initializing') {
      throw new GISRuntimeError({ code: 'APP_INVALID_STATE', message: 'Tools can only be registered during plugin installation.', stage: 'plugin-install' })
    }
    if (definition.id !== id) {
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message: `Tool definition id "${definition.id}" does not match registration id "${id}".`,
        stage: 'tool-registration',
      })
    }
    this.interactions.registerTool(id, definition, resources)
  }

  private resolvePluginOrder(): PluginRecord[] {
    const ordered: PluginRecord[] = []
    const visiting = new Set<string>()
    const visited = new Set<string>()

    const visit = (name: string, via?: string) => {
      if (visited.has(name)) return
      if (visiting.has(name)) {
        throw new GISRuntimeError({
          code: 'PLUGIN_DEPENDENCY_MISSING',
          message: `Plugin dependency cycle detected at "${name}".`,
          stage: 'plugin-validation',
          detail: { plugin: via ?? name },
        })
      }
      const record = this.plugins.get(name)
      if (!record) {
        throw new GISRuntimeError({
          code: 'PLUGIN_DEPENDENCY_MISSING',
          message: `Required plugin "${name}" is not registered.`,
          stage: 'plugin-validation',
          detail: { plugin: via },
        })
      }

      visiting.add(name)
      for (const dependency of record.plugin.dependencies ?? []) visit(dependency, name)
      visiting.delete(name)
      visited.add(name)
      ordered.push(record)
    }

    for (const name of this.plugins.keys()) visit(name)
    return ordered
  }

  private async cleanupResources(): Promise<unknown[]> {
    this.search.dispose()
    const errors: unknown[] = []
    ;(this.data as DataServiceImpl).abortPending()
    await (this.data as DataServiceImpl).settle()
    await (this.layers as LayerServiceImpl).settle()
    for (const record of [...this.installationOrder].reverse()) {
      try {
        if (!record.resources.disposed) await record.resources.dispose()
      } catch (error) {
        errors.push(error)
      }
    }
    for (const record of [...this.plugins.values()].reverse()) {
      if (record.installed || record.resources.disposed) continue
      try {
        await record.resources.dispose()
      } catch (error) {
        errors.push(error)
      }
    }
    for (const scope of [this.mapResources, this.resources]) {
      try { await scope.dispose() } catch (error) { errors.push(error) }
    }
    return errors
  }

  private hasMapAdapter(): boolean {
    return (this.map as MapServiceImpl).hasAdapter
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.operationQueue.then(operation)
    this.operationQueue = result.catch(() => undefined)
    return result
  }

  private assertStatus(expected: AppStatus, action: string): void {
    if (this.currentStatus === 'disposed' || this.currentStatus === 'disposing') {
      throw new GISRuntimeError({
        code: 'APP_DISPOSED',
        message: `Cannot ${action}; the app is ${this.currentStatus}.`,
        stage: action,
      })
    }
    if (this.currentStatus !== expected) {
      throw new GISRuntimeError({
        code: 'APP_INVALID_STATE',
        message: `Cannot ${action} while the app is ${this.currentStatus}; expected ${expected}.`,
        stage: action,
      })
    }
  }

  private reportError(error: GISRuntimeError): void {
    try {
      this.events.emit('app:error', { error })
    } catch {
      // Event listeners must not replace the original runtime error.
    }
    try {
      this.options.onError?.(error)
    } catch {
      // Reporting must never replace the operation's original failure.
    }
  }
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `gis-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
