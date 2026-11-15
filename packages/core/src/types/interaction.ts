import type { AppContext } from './app.js'
import type { Unsubscribe } from './common.js'
import type { ResourceScope } from './plugin.js'

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
