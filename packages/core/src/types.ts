export type AppStatus =
  | 'created'
  | 'initializing'
  | 'ready'
  | 'mounted'
  | 'unmounted'
  | 'disposing'
  | 'disposed'
  | 'error'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type ReadonlyJsonValue = JsonPrimitive | readonly ReadonlyJsonValue[] | { readonly [key: string]: ReadonlyJsonValue }
export type DeepReadonly<T> = [JsonValue] extends [T] ? ReadonlyJsonValue : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T
export interface MapStateSnapshot {
  readonly ready: boolean
  readonly projection: string | null
  readonly center: readonly [number, number] | null
  readonly zoom: number | null
  readonly resolution: number | null
  /** Ground resolution at the view center, supplied by the map adapter. */
  readonly metersPerPixel: number | null
  readonly rotation: number | null
}
export interface LayerStateSnapshot {
  readonly version: number
  readonly id: string
  readonly type: string
  readonly title: string | null
  readonly visible: boolean
  readonly status: LayerInstance['status']
  readonly metadata: Readonly<Record<string, JsonValue>>
  readonly legend: LegendDefinition | null
}
export interface DataStateSnapshot {
  readonly id: string
  readonly status: DataSet['status']
  readonly error: string | null
}
export interface AppStateSnapshot {
  readonly revision: number
  readonly status: AppStatus
  readonly map: MapStateSnapshot
  readonly layers: readonly LayerStateSnapshot[]
  readonly data: readonly DataStateSnapshot[]
  readonly interactions: { readonly activeToolId: string | null; readonly selection: FeatureReference | null }
  readonly extensions: Readonly<Record<string, JsonValue>>
}
export interface AppState {
  snapshot(): DeepReadonly<AppStateSnapshot>
  subscribe(listener: (snapshot: DeepReadonly<AppStateSnapshot>) => void): Unsubscribe
}
export interface StateContributor {
  snapshot(): JsonValue
  subscribe(listener: () => void): Unsubscribe
}

export interface GISAppConfig {
  readonly version?: string
  readonly title?: { readonly content: string; readonly icon?: string }
  readonly map?: MapConfig
  readonly layers?: readonly LayerConfig[]
  readonly data?: Readonly<Record<string, DataSourceConfig>>
  readonly ui?: UIConfig
  readonly [key: string]: unknown
}

export type PanelPosition = 'left' | 'right' | 'top' | 'bottom' | 'floating'

export interface UIThemeConfig {
  readonly mode?: 'light' | 'dark' | 'system'
  readonly tokens?: Readonly<Record<string, string>>
  readonly className?: string
}
export interface UIConfig {
  /** Known built-in tool IDs to show; omitted shows all available built-ins. */
  readonly tools?: readonly string[]
  readonly layout?: string
  readonly theme?: 'light' | 'dark' | 'system' | UIThemeConfig
  readonly locale?: 'zh' | 'en'
  readonly panels?: readonly PanelConfig[]
}

/** Framework-independent, serializable panel metadata shared by UI adapters. */
export interface PanelDescriptor {
  readonly id: string
  readonly title?: string
  readonly position?: PanelPosition
  readonly order?: number
  readonly defaultVisible?: boolean
}

/** Application configuration for a panel that has been registered in the UI. */
export interface PanelConfig {
  readonly id: string
  readonly visible?: boolean
  readonly collapsed?: boolean
  readonly position?: PanelPosition
  readonly order?: number
  readonly width?: number | string
  readonly height?: number | string
}

/** Map-domain legend description; contains no UI framework values. */
export interface LegendDefinition {
  /** Opt in to the layer's uniform style for a single category symbol. */
  readonly useLayerStyle?: boolean
  readonly id: string
  readonly layerId?: string
  readonly title?: string
  readonly type: 'category' | 'continuous' | 'interval' | 'image'
  readonly items?: readonly LegendItem[]
  readonly stops?: readonly LegendStop[]
  readonly noData?: LegendItem
  readonly imageUrl?: string
}

export interface LegendItem {
  readonly id: string
  readonly label: string
  readonly color?: string
  readonly symbol?: 'fill' | 'line' | 'circle' | 'square'
  readonly visible?: boolean
}

export interface LegendStop {
  readonly value: number
  readonly color: string
  readonly label?: string
}

export interface MapConfig {
  readonly projection?: string
  readonly center?: readonly [number, number]
  readonly zoom?: number
  readonly minZoom?: number
  readonly maxZoom?: number
}

export interface LayerConfig {
  readonly legend?: LayerLegend
  readonly id: string
  readonly type: string
  readonly title?: string
  readonly visible?: boolean
  readonly zIndex?: number
  readonly source?: JsonValue
  readonly options?: Readonly<Record<string, JsonValue>>
  readonly children?: readonly LayerConfig[]
}

export interface MapViewService {
  getCenter(): readonly [number, number] | undefined
  setCenter(center: readonly [number, number]): void
  getZoom(): number | undefined
  setZoom(zoom: number): void
  fit(extent: readonly [number, number, number, number]): void
}

export interface MapLayerHandle {
  /** Current finite data coverage, preferably in the current map projection. */
  getDataLocation?(): MapLocation | undefined
  resolveLegend?(legend: LegendDefinition): LegendDefinition
  getTimeDimensions?(): readonly LayerTimeDimension[]
  getTimeFilter?(): LayerTimeFilter | undefined
  setTimeFilter?(filter: LayerTimeFilter | undefined): void
  setVisible(visible: boolean): void
  setZIndex(zIndex: number): void
  update?(patch: LayerUpdate): void | Promise<void>
  dispose(): void | Promise<void>
  getMetadata?(): Readonly<Record<string, unknown>>
}

export interface MapAdapter {
  /** Pointer longitude/latitude (EPSG:4326); undefined when leaving the viewport. */
  onPointerMove?(listener: (coordinate: readonly [number, number] | undefined) => void): Unsubscribe
  locate?(location: MapLocation): void
  readonly name: string
  create(config: MapConfig): void | Promise<void>
  destroy(): void | Promise<void>
  getView(): MapViewService
  getSize(): [number, number] | undefined
  updateSize(): void
  setTarget(target: HTMLElement | string | undefined): void
  addLayer(layer: MapLayerHandle, index?: number): void
  removeLayer(layer: MapLayerHandle): void
  setLayerOrder(layers: readonly MapLayerHandle[]): void
  getViewState?(): Omit<MapStateSnapshot, 'ready'>
  onViewChange?(listener: () => void): Unsubscribe
}

export interface MapService {
  onPointerMove(listener: (coordinate: readonly [number, number] | undefined) => void): Unsubscribe
  locate(location: MapLocation): void
  readonly isReady: boolean
  getView(): MapViewService
  getSize(): [number, number] | undefined
  updateSize(): void
  setTarget(target: HTMLElement | string | undefined): void
  getAdapter(): MapAdapter
}

export interface LayerUpdate {
  /** Checked inside the layer's update queue before applying any engine changes. */
  readonly expectedVersion?: number
  readonly legend?: LayerLegend | null
  readonly title?: string
  readonly visible?: boolean
  readonly zIndex?: number
  readonly options?: Readonly<Record<string, JsonValue>>
}

/** A discrete, UTC-normalized date/time field exposed by a layer adapter. */
export interface LayerTimeDimension {
  readonly field: string
  readonly values: readonly number[]
}

/** Inclusive epoch-millisecond range applied to one layer date/time field. */
export interface LayerTimeFilter {
  readonly field: string
  readonly start: number
  readonly end: number
}

export interface LayerInstance {
  readonly version: number
  readonly legend: LegendDefinition | undefined
  readonly id: string
  readonly type: string
  readonly title?: string
  readonly status: 'created' | 'loading' | 'ready' | 'error' | 'disposed'
  readonly visible: boolean
  setVisibility(visible: boolean): void
  getTimeDimensions(): readonly LayerTimeDimension[]
  getTimeFilter(): LayerTimeFilter | undefined
  setTimeFilter(filter: LayerTimeFilter | undefined): void
  update(patch: LayerUpdate): Promise<void>
  dispose(): Promise<void>
  getMetadata(): Readonly<Record<string, unknown>>
}

export interface LayerTypeDefinition {
  create(context: AppContext, config: LayerConfig): MapLayerHandle | Promise<MapLayerHandle>
}

export interface LayerService {
  getDataLocation(id: string): MapLocation | undefined
  add(config: LayerConfig): Promise<LayerInstance>
  remove(id: string): Promise<void>
  update(id: string, patch: LayerUpdate): Promise<void>
  get(id: string): LayerInstance | undefined
  has(id: string): boolean
  list(): LayerInstance[]
  setVisibility(id: string, visible: boolean): void
  setOrder(ids: string[]): void
  clear(): Promise<void>
  subscribe(listener: (event: { type: 'add' | 'remove' | 'update' | 'order' | 'visibility'; id?: string; visible?: boolean }) => void): Unsubscribe
}

export interface DataSourceConfig {
  readonly id?: string
  readonly type: 'url' | 'inline'
  readonly url?: string
  readonly data?: JsonValue
  readonly format?: 'json' | 'text'
}

export interface DataLoadOptions {
  readonly id?: string
  readonly signal?: AbortSignal
  readonly processor?: string
}

export interface DataSet<T = unknown> {
  readonly id: string
  readonly status: 'loading' | 'ready' | 'error' | 'disposed'
  readonly data?: T
  readonly error?: Error
  subscribe(listener: (data: T) => void): Unsubscribe
  /** Pure synchronous validation before update commits; throwing preserves old data. */
  validate(validator: (data: T) => void): Unsubscribe
  update(data: T): void
  dispose(): Promise<void>
}

export interface DataService {
  load<T = unknown>(source: DataSourceConfig, options?: DataLoadOptions): Promise<DataSet<T>>
  get<T = unknown>(id: string): DataSet<T> | undefined
  remove(id: string): Promise<void>
  clear(): Promise<void>
}

export interface DataProcessor<Input = unknown, Output = unknown> {
  process(input: Input, context: AppContext): Output | Promise<Output>
}

export interface FeatureReference {
  /** Selection owner; omitted means a business layer. Other owners manage their own invalidation. */
  readonly source?: string
  readonly id?: string | number
  readonly layerId: string
  readonly properties?: Readonly<Record<string, unknown>>
  readonly geometryType?: string
}

export interface SelectOptions {
  readonly feature: FeatureReference
}

export interface ToolDefinition {
  /** Actions execute once and do not remain the active interaction. */
  readonly mode?: 'action'
  canActivate?(context: AppContext): boolean
  undo?(context: AppContext): void
  readonly id: string
  readonly title?: string
  activate(context: AppContext): void | Promise<void>
  deactivate?(context: AppContext): void | Promise<void>
}

export interface InteractionService {
  hasTool(id: string): boolean
  canActivateTool(id: string): boolean
  undoActiveTool(): void
  select(options?: SelectOptions): void
  clearSelection(): void
  getSelection(): FeatureReference | undefined
  onSelect(listener: (feature: FeatureReference | undefined) => void): Unsubscribe
  registerTool(id: string, definition: ToolDefinition, resources: ResourceScope): void
  activateTool(id: string): Promise<void>
  deactivateTool(): Promise<void>
  getActiveTool(): string | undefined
}

export interface GISAppEvents {
  'app:ready': { appId: string }
  'app:error': { error: GISRuntimeError }
  'layer:added': { layerId: string }
  'layer:removed': { layerId: string }
  'layer:updated': { layerId: string }
  'layer:visibility-changed': { layerId: string; visible: boolean }
  'tool:activated': { toolId: string }
  'tool:deactivated': { toolId: string }
  'feature:selected': { feature?: FeatureReference }
}

export interface EventService {
  on<K extends keyof GISAppEvents>(event: K, listener: (payload: GISAppEvents[K]) => void): Unsubscribe
  once<K extends keyof GISAppEvents>(event: K, listener: (payload: GISAppEvents[K]) => void): Unsubscribe
  emit<K extends keyof GISAppEvents>(event: K, payload: GISAppEvents[K]): void
}

export interface GISAppOptions {
  id?: string
  name?: string
  debug?: boolean
  onError?: (error: GISRuntimeError) => void
}

export type GISRuntimeErrorCode =
  | 'APP_INVALID_STATE'
  | 'APP_DISPOSED'
  | 'CONFIG_INVALID'
  | 'PLUGIN_DUPLICATE'
  | 'PLUGIN_DEPENDENCY_MISSING'
  | 'PLUGIN_INSTALL_FAILED'
  | 'APP_INITIALIZATION_FAILED'
  | 'APP_DISPOSE_FAILED'
  | 'UI_ADAPTER_MISSING'
  | 'ADAPTER_MISSING'
  | 'LAYER_DUPLICATE'
  | 'LAYER_TYPE_NOT_FOUND'
  | 'LAYER_TYPE_DUPLICATE'
  | 'LAYER_NOT_FOUND'
  | 'DATASET_NOT_FOUND'
  | 'DATASET_DUPLICATE'
  | 'DATA_LOAD_FAILED'
  | 'SEARCH_FAILED'
  | 'DATA_PROCESSOR_NOT_FOUND'
  | 'DATA_PROCESSOR_DUPLICATE'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_DUPLICATE'

export class GISRuntimeError extends Error {
  readonly code: GISRuntimeErrorCode
  readonly stage?: string
  readonly detail?: unknown
  override readonly cause?: unknown
  readonly cleanupErrors?: readonly unknown[]

  constructor(options: {
    code: GISRuntimeErrorCode
    message: string
    stage?: string
    detail?: unknown
    cause?: unknown
    cleanupErrors?: readonly unknown[]
  }) {
    super(options.message, { cause: options.cause })
    this.name = 'GISRuntimeError'
    this.code = options.code
    this.stage = options.stage
    this.detail = options.detail
    this.cause = options.cause
    this.cleanupErrors = options.cleanupErrors
  }
}

export interface GISPlugin<Options = unknown> {
  readonly name: string
  readonly version?: string
  readonly dependencies?: readonly string[]
  install(app: GISApp, options: Options | undefined, resources: ResourceScope): void
  onInit?(app: GISApp, options: Options | undefined): void | Promise<void>
}

export interface PluginInstance {
  readonly name: string
  readonly version?: string
}

export interface ResourceScope {
  readonly disposed: boolean
  add(dispose: () => void | Promise<void>): Unsubscribe
  dispose(): Promise<void>
}

export type Unsubscribe = () => void

export interface UIAdapter {
  mount(target: Element | string): void | Promise<void>
  unmount(): void | Promise<void>
  dispose(): void | Promise<void>
}

export interface GISApp {
  readonly search: SearchService
  readonly id: string
  readonly name?: string
  readonly status: AppStatus
  readonly config?: Readonly<GISAppConfig>
  readonly context: AppContext
  registerStateSlice(name: string, contributor: StateContributor, resources: ResourceScope): void
  readonly map: MapService
  readonly layers: LayerService
  readonly data: DataService
  readonly interactions: InteractionService
  readonly events: EventService
  use<Options>(plugin: GISPlugin<Options>, options?: Options): this
  /** Adapter plugins register through this framework-neutral bridge during install. */
  registerUIAdapter(adapter: UIAdapter, resources: ResourceScope): void
  registerMapAdapter(adapter: MapAdapter, resources: ResourceScope): void
  registerLayerType(type: string, definition: LayerTypeDefinition, resources: ResourceScope): void
  registerDataProcessor<Input, Output>(name: string, processor: DataProcessor<Input, Output>, resources: ResourceScope): void
  registerTool(id: string, definition: ToolDefinition, resources: ResourceScope): void
  init(config: GISAppConfig): Promise<void>
  mount(target: Element | string): Promise<void>
  unmount(): Promise<void>
  dispose(): Promise<void>
  getPlugin(name: string): PluginInstance | undefined
}

export interface AppContext {
  readonly search: SearchService
  readonly state: AppState
  readonly config?: Readonly<GISAppConfig>
  readonly resources: ResourceScope
  readonly map: MapService
  readonly layers: LayerService
  readonly data: DataService
  readonly interactions: InteractionService
  readonly events: EventService
}

export type LayerLegend = Omit<LegendDefinition, 'id' | 'layerId'> & { readonly id?: string }
/** Omitted projection means the current map projection. */
export interface MapLocation {
  readonly projection?: string
  readonly coordinate?: readonly [number, number]
  readonly extent?: readonly [number, number, number, number]
}
export interface SearchResult<T = unknown> extends MapLocation {
  readonly layerId?: string
  readonly id: string
  readonly title: string
  readonly subtitle?: string
  readonly data?: T
}
export interface SearchQuery {
  readonly layerId?: string
  readonly keyword: string
  readonly filters?: Readonly<Record<string, unknown>>
  readonly signal?: AbortSignal
}
export interface SearchProvider {
  readonly id: string
  /** Omitted means a general provider that must honor query.layerId when present. */
  readonly layerIds?: readonly string[]
  search(query: SearchQuery): Promise<readonly SearchResult[]>
}
export interface SearchService {
  registerProvider(provider: SearchProvider, resources?: ResourceScope): Unsubscribe
  listProviders(): readonly SearchProvider[]
  subscribe(listener: () => void): Unsubscribe
  search(query: SearchQuery): Promise<SearchResult[]>
}
