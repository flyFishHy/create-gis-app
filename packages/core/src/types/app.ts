import type { MapAdapter, MapConfig, MapService } from './map.js'
import type { LayerConfig, LayerService, LayerTypeDefinition } from '../types.js'
import type { DataProcessor, DataService, DataSourceConfig } from './data.js'
import type { UIAdapter, UIConfig } from './ui.js'
import type { GISRuntimeError } from '../errors.js'
import type { SearchService } from './search.js'
import type { AppStatus } from './common.js'
import type { AppState, StateContributor } from './state.js'
import type { GISPlugin, PluginInstance, ResourceScope } from './plugin.js'
import type { InteractionService, ToolDefinition } from './interaction.js'
import type { EventService } from './events.js'

export interface GISAppConfig {
  readonly version?: string
  readonly title?: { readonly content: string; readonly icon?: string; readonly subtitle?: string }
  readonly map?: MapConfig
  readonly layers?: readonly LayerConfig[]
  readonly data?: Readonly<Record<string, DataSourceConfig>>
  readonly ui?: UIConfig
  readonly [key: string]: unknown
}

export interface GISAppOptions {
  id?: string
  name?: string
  debug?: boolean
  onError?: (error: GISRuntimeError) => void
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
