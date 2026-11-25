import { normalizeConfig } from '../config/app-config.js';
import { ResourceScopeImpl, assertResourceScopeActive } from './resource-scope.js';
import { LayerServiceImpl } from '../layers/layer-service.js';
import { MapServiceImpl } from '../map/map-service.js';
import { DataServiceImpl } from '../data/data-service.js';
import { EventServiceImpl } from './event-service.js';
import { InteractionServiceImpl } from '../interactions/interaction-service.js';
import { SearchServiceImpl } from '../search/search-service.js';
import { GISRuntimeError } from '../errors.js';
import { AppContextImpl } from '../context/app-context.js';
import { AppStateImpl } from '../state/app-state.js';
import { createSnapshotReader } from '../state/read-snapshot.js';
import { resolvePluginOrder } from './plugin-order.js';
import type { StateContributor } from '../types.js';
import type {
  AppContext,
  AppStatus,
  GISApp,
  GISAppConfig,
  GISAppOptions,
  DataProcessor,
  DataSourceConfig,
  LayerConfig,
  LayerTypeDefinition,
  MapAdapter,
  MapConfig,
  GISPlugin,
  PluginInstance,
  ResourceScope,
  ToolDefinition,
  UIAdapter,
} from '../types.js';

interface PluginRecord {
  readonly plugin: GISPlugin<unknown>;
  readonly options: unknown;
  readonly resources: ResourceScopeImpl;
  installed: boolean;
}

export function createGISApp(options: GISAppOptions = {}): GISApp {
  return new GISAppImpl(options);
}

class GISAppImpl implements GISApp {
  readonly id: string;
  readonly name?: string;
  readonly context: AppContext;
  readonly map: MapServiceImpl;
  readonly layers: LayerServiceImpl;
  readonly data: DataServiceImpl;
  readonly interactions: InteractionServiceImpl;
  readonly events: EventServiceImpl;
  readonly search: SearchServiceImpl;
  readonly #state: AppStateImpl;
  private readonly initializeContextConfig: (config: Readonly<GISAppConfig>) => void;
  private get currentStatus(): AppStatus {
    return this.#state.status;
  }
  private set currentStatus(status: AppStatus) {
    this.#state.setStatus(status);
  }
  private readonly resources = new ResourceScopeImpl();
  private readonly mapResources = new ResourceScopeImpl();
  private readonly plugins = new Map<string, PluginRecord>();
  private readonly pluginInstances = new WeakSet<object>();
  private readonly installationOrder: PluginRecord[] = [];
  private uiAdapter?: UIAdapter;
  private operationQueue: Promise<void> = Promise.resolve();
  private disposePromise?: Promise<void>;

  constructor(options: GISAppOptions) {
    this.id = options.id ?? createId();
    this.name = options.name;
    this.events = new EventServiceImpl(options.onError);
    this.search = new SearchServiceImpl(() => this.status, this.events);
    this.#state = new AppStateImpl(this.events);
    this.map = new MapServiceImpl(this.#state);
    const dependencies = { state: this.#state, context: () => this.context };
    this.layers = new LayerServiceImpl(this.map, dependencies);
    this.data = new DataServiceImpl(dependencies);
    this.interactions = new InteractionServiceImpl(dependencies, this.events);
    const assembly = AppContextImpl.create({
      map: this.map,
      layers: this.layers,
      data: this.data,
      interactions: this.interactions,
      search: this.search,
      events: this.events,
      resources: this.resources,
      state: this.#state.view,
    });
    this.context = assembly.context;
    this.initializeContextConfig = assembly.initializeConfig;
    const map = this.map;
    const layers = this.layers;
    const data = this.data;
    const events = this.events;
    this.#state.connect(
      createSnapshotReader(
        () => map.snapshot(),
        () => layers.list(),
        () => data.snapshot()
      )
    );
    this.resources.add(() => data.clear());
    const unsubscribeLayerEvents = this.layers.subscribe((event) => {
      if (!event.id) {
        return;
      }
      if (event.type === 'add') {
        events.emit('layer:added', { layerId: event.id });
      } else if (event.type === 'remove') {
        events.emit('layer:removed', { layerId: event.id });
      } else if (event.type === 'visibility') {
        events.emit('layer:visibility-changed', {
          layerId: event.id,
          visible: event.visible ?? true,
        });
      } else if (event.type === 'update') {
        events.emit('layer:updated', { layerId: event.id });
      }
    });
    this.resources.add(unsubscribeLayerEvents);
  }

  get status(): AppStatus {
    return this.currentStatus;
  }

  get config(): Readonly<GISAppConfig> | undefined {
    return this.context.config;
  }

  registerStateSlice(name: string, contributor: StateContributor, resources: ResourceScope): void {
    if (!['initializing', 'ready', 'mounted', 'unmounted'].includes(this.status)) {
      this.assertStatus('initializing', 'register state slice');
    }
    assertResourceScopeActive(resources);
    const stop = this.#state.register(name, contributor);
    try {
      resources.add(stop);
    } catch (error) {
      stop();
      throw error;
    }
  }

  use<Options>(plugin: GISPlugin<Options>, options?: Options): this {
    this.assertStatus('created', 'use plugins');
    if (!plugin.name?.trim()) {
      throw new GISRuntimeError({
        code: 'PLUGIN_INSTALL_FAILED',
        message: 'Plugin name must be a non-empty string.',
        stage: 'plugin-registration',
      });
    }
    if (this.plugins.has(plugin.name)) {
      throw new GISRuntimeError({
        code: 'PLUGIN_DUPLICATE',
        message: `Plugin "${plugin.name}" is already registered.`,
        stage: 'plugin-registration',
      });
    }
    if (this.pluginInstances.has(plugin)) {
      throw new GISRuntimeError({
        code: 'PLUGIN_DUPLICATE',
        message: `The plugin instance "${plugin.name}" is already registered.`,
        stage: 'plugin-registration',
      });
    }

    const record: PluginRecord = {
      plugin: plugin as unknown as GISPlugin<unknown>,
      options,
      resources: new ResourceScopeImpl(),
      installed: false,
    };
    this.pluginInstances.add(plugin);
    this.plugins.set(plugin.name, record);
    return this;
  }

  init(config: GISAppConfig): Promise<void> {
    return this.enqueue(async () => {
      this.assertStatus('created', 'initialize the app');
      this.currentStatus = 'initializing';
      let stage = 'config-validation';

      try {
        this.initializeContextConfig(normalizeConfig(config));
        stage = 'plugin-validation';
        const orderedPlugins = resolvePluginOrder(this.plugins);

        stage = 'plugin-install';
        for (const record of orderedPlugins) {
          this.installationOrder.push(record);
          record.plugin.install(this, record.options, record.resources);
          record.installed = true;
        }

        stage = 'plugin-initialization';
        for (const record of orderedPlugins) {
          await record.plugin.onInit?.(this, record.options);
        }

        const configuredData = this.config?.data;
        if (
          configuredData &&
          typeof configuredData === 'object' &&
          !Array.isArray(configuredData)
        ) {
          stage = 'data-initialization';
          for (const [id, source] of Object.entries(configuredData)) {
            await this.data.load(source as DataSourceConfig, { id });
          }
        }
        const mapConfig = this.config?.map as MapConfig | undefined;
        const initialLayers = (this.config?.layers ?? []) as readonly LayerConfig[];
        if (mapConfig || initialLayers.length > 0 || this.hasMapAdapter()) {
          stage = 'map-create';
          await this.map.create(mapConfig ?? {});
          this.mapResources.add(() => this.map.destroy());
          this.mapResources.add(() => this.layers.clear());
          stage = 'initial-layer-create';
          for (const layer of initialLayers) {
            await this.layers.add(layer);
          }
        }

        this.currentStatus = 'ready';
        this.events.emit('app:ready', { appId: this.id });
      } catch (cause) {
        this.currentStatus = 'error';
        try {
          await this.interactions.deactivateTool();
        } catch {
          /* preserve initialization failure */
        }
        const cleanupErrors = await this.cleanupResources();
        this.currentStatus = 'error';
        const error =
          cause instanceof GISRuntimeError
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
              });
        this.reportError(error);
        throw error;
      }
    });
  }

  mount(target: Element | string): Promise<void> {
    return this.enqueue(async () => {
      if (this.currentStatus !== 'unmounted') {
        this.assertStatus('ready', 'mount the app');
      }
      if (!this.uiAdapter) {
        throw new GISRuntimeError({
          code: 'UI_ADAPTER_MISSING',
          message: 'No UI Adapter is registered for this app.',
          stage: 'mount',
        });
      }
      try {
        await this.uiAdapter.mount(target);
        this.currentStatus = 'mounted';
      } catch (cause) {
        try {
          await this.uiAdapter.unmount();
        } catch (cleanupError) {
          const error = new GISRuntimeError({
            code: 'APP_INITIALIZATION_FAILED',
            message: 'UI mount failed and its cleanup also failed.',
            stage: 'mount',
            cause,
            cleanupErrors: [cleanupError],
          });
          this.reportError(error);
          throw error;
        }
        throw cause;
      }
    });
  }

  unmount(): Promise<void> {
    return this.enqueue(async () => {
      this.assertStatus('mounted', 'unmount the app');
      await this.uiAdapter?.unmount();
      this.currentStatus = 'unmounted';
    });
  }

  dispose(): Promise<void> {
    if (this.disposePromise) {
      return this.disposePromise;
    }
    this.disposePromise = this.enqueue(async () => {
      if (this.currentStatus === 'disposed') {
        return;
      }
      this.currentStatus = 'disposing';
      const errors: unknown[] = [];

      if (this.uiAdapter) {
        try {
          await this.uiAdapter.unmount();
        } catch (error) {
          errors.push(error);
        }
      }

      try {
        await this.interactions.deactivateTool();
      } catch (error) {
        errors.push(error);
      }

      errors.push(...(await this.cleanupResources()));
      if (this.interactions.getSelection()) {
        this.interactions.clearSelection();
      }
      this.interactions.close();
      this.currentStatus = 'disposed';
      this.#state.close();

      if (errors.length > 0) {
        const error = new GISRuntimeError({
          code: 'APP_DISPOSE_FAILED',
          message: `${errors.length} resource cleanup operation(s) failed during app disposal.`,
          stage: 'dispose',
          cleanupErrors: errors,
        });
        this.reportError(error);
        this.events.close();
        throw error;
      }
      this.events.close();
    });
    return this.disposePromise;
  }

  getPlugin(name: string): PluginInstance | undefined {
    const record = this.plugins.get(name);
    if (!record) {
      return undefined;
    }
    return { name: record.plugin.name, version: record.plugin.version };
  }

  registerUIAdapter(adapter: UIAdapter, resources: ResourceScope): void {
    assertResourceScopeActive(resources);
    if (this.currentStatus !== 'initializing') {
      throw new GISRuntimeError({
        code: 'APP_INVALID_STATE',
        message: 'UI Adapter registration is only allowed during plugin installation.',
        stage: 'plugin-install',
      });
    }
    if (this.uiAdapter) {
      throw new GISRuntimeError({
        code: 'PLUGIN_DUPLICATE',
        message: 'Only one UI Adapter can be registered per app.',
        stage: 'plugin-install',
      });
    }
    this.uiAdapter = adapter;
    try {
      resources.add(async () => {
        try {
          await adapter.dispose();
        } finally {
          if (this.uiAdapter === adapter) {
            this.uiAdapter = undefined;
          }
        }
      });
    } catch (error) {
      this.uiAdapter = undefined;
      throw error;
    }
  }

  registerMapAdapter(adapter: MapAdapter, resources: ResourceScope): void {
    assertResourceScopeActive(resources);
    if (this.currentStatus !== 'initializing') {
      throw new GISRuntimeError({
        code: 'APP_INVALID_STATE',
        message: 'Map Adapter registration is only allowed during plugin installation.',
        stage: 'plugin-install',
      });
    }
    this.map.registerAdapter(adapter);
    const map = this.map;
    try {
      resources.add(() => map.unregisterAdapter(adapter));
    } catch (error) {
      map.unregisterAdapter(adapter);
      throw error;
    }
  }

  registerLayerType(type: string, definition: LayerTypeDefinition, resources: ResourceScope): void {
    assertResourceScopeActive(resources);
    if (this.currentStatus !== 'initializing') {
      throw new GISRuntimeError({
        code: 'APP_INVALID_STATE',
        message: 'Layer types can only be registered during plugin installation.',
        stage: 'plugin-install',
      });
    }
    this.layers.registerType(type, definition);
    try {
      resources.add(() => this.layers.unregisterType(type, definition));
    } catch (error) {
      this.layers.unregisterType(type, definition);
      throw error;
    }
  }

  registerDataProcessor<Input, Output>(
    name: string,
    processor: DataProcessor<Input, Output>,
    resources: ResourceScope
  ): void {
    if (this.currentStatus !== 'initializing') {
      throw new GISRuntimeError({
        code: 'APP_INVALID_STATE',
        message: 'Data processors can only be registered during plugin installation.',
        stage: 'plugin-install',
      });
    }
    this.data.registerProcessorResource(name, processor, resources);
  }

  registerTool(id: string, definition: ToolDefinition, resources: ResourceScope): void {
    if (this.currentStatus !== 'initializing') {
      throw new GISRuntimeError({
        code: 'APP_INVALID_STATE',
        message: 'Tools can only be registered during plugin installation.',
        stage: 'plugin-install',
      });
    }
    if (definition.id !== id) {
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message: `Tool definition id "${definition.id}" does not match registration id "${id}".`,
        stage: 'tool-registration',
      });
    }
    this.interactions.registerTool(id, definition, resources);
  }

  private async cleanupResources(): Promise<unknown[]> {
    this.search.dispose();
    const errors: unknown[] = [];
    this.data.abortPending();
    await this.data.settle();
    await this.layers.settle();
    for (const record of [...this.installationOrder].reverse()) {
      try {
        if (!record.resources.disposed) {
          await record.resources.dispose();
        }
      } catch (error) {
        errors.push(error);
      }
    }
    for (const record of [...this.plugins.values()].reverse()) {
      if (record.installed || record.resources.disposed) {
        continue;
      }
      try {
        await record.resources.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    for (const scope of [this.mapResources, this.resources]) {
      try {
        await scope.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }

  private hasMapAdapter(): boolean {
    return this.map.hasAdapter;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.catch(() => undefined);
    return result;
  }

  private assertStatus(expected: AppStatus, action: string): void {
    if (this.currentStatus === 'disposed' || this.currentStatus === 'disposing') {
      throw new GISRuntimeError({
        code: 'APP_DISPOSED',
        message: `Cannot ${action}; the app is ${this.currentStatus}.`,
        stage: action,
      });
    }
    if (this.currentStatus !== expected) {
      throw new GISRuntimeError({
        code: 'APP_INVALID_STATE',
        message: `Cannot ${action} while the app is ${this.currentStatus}; expected ${expected}.`,
        stage: action,
      });
    }
  }

  private reportError(error: GISRuntimeError): void {
    try {
      this.events.emit('app:error', { error });
    } catch {
      // Event listeners must not replace the original runtime error.
    }
  }
}

function createId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `gis-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}
