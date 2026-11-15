import { GISRuntimeError } from './types.js'
import type { ServiceDependencies } from './context/service-dependencies.js'
import type {
  AppContext,
  EventService,
  FeatureReference,
  InteractionService,
  ResourceScope,
  SelectOptions,
  ToolDefinition,
  Unsubscribe,
} from './types.js'

export class InteractionServiceImpl implements InteractionService {
  private get selection(): FeatureReference | undefined { return this.dependencies.state.interactions.selection ?? undefined }
  private set selection(selection: FeatureReference | undefined) { this.dependencies.state.setInteractions({ selection: selection ?? null }) }
  private readonly selectionListeners = new Set<(feature: FeatureReference | undefined) => void>()
  private readonly tools = new Map<string, ToolDefinition>()
  private get activeToolId(): string | undefined { return this.dependencies.state.interactions.activeToolId ?? undefined }
  private set activeToolId(id: string | undefined) { this.dependencies.state.setInteractions({ activeToolId: id ?? null }) }
  private transition: Promise<void> = Promise.resolve()

  constructor(private readonly dependencies: ServiceDependencies, private readonly events: EventService) {}
  private get context(): AppContext { return this.dependencies.context() }

  select(options?: SelectOptions): void {
    const feature = options?.feature
    this.selection = feature
      ? Object.freeze({ ...feature, properties: feature.properties ? Object.freeze({ ...feature.properties }) : undefined })
      : undefined
    for (const listener of [...this.selectionListeners]) {
      try { listener(this.selection) } catch (cause) { this.events.emit('app:error', { error: new GISRuntimeError({ code: 'APP_INVALID_STATE', message: 'Selection observer failed.', stage: 'event-listener', cause }) }) }
    }
    this.events.emit('feature:selected', { feature: this.selection })
  }

  clearSelection(): void { this.select() }
  getSelection(): FeatureReference | undefined { return this.selection }

  onSelect(listener: (feature: FeatureReference | undefined) => void): Unsubscribe {
    this.selectionListeners.add(listener)
    return () => this.selectionListeners.delete(listener)
  }

  registerTool(id: string, definition: ToolDefinition, resources: ResourceScope): void {
    if (!id.trim() || this.tools.has(id) || definition.id !== id) {
      throw new GISRuntimeError({
        code: 'TOOL_DUPLICATE',
        message: `Tool "${id}" is invalid or already registered.`,
        stage: 'tool-registration',
      })
    }
    this.tools.set(id, definition)
    resources.add(() => this.unregisterTool(id, definition))
  }

  activateTool(id: string): Promise<void> {
    return this.enqueue(async () => {
      const status = this.dependencies.state.status
      if (!['initializing', 'ready', 'mounted', 'unmounted'].includes(status)) {
        throw new GISRuntimeError({
          code: status === 'disposed' || status === 'disposing' ? 'APP_DISPOSED' : 'APP_INVALID_STATE',
          message: `Cannot activate a tool while the app is ${status}.`,
          stage: 'tool-activation',
        })
      }
      const next = this.tools.get(id)
      if (!next) throw new GISRuntimeError({
        code: 'TOOL_NOT_FOUND',
        message: `Tool "${id}" was not found.`,
        stage: 'tool-activation',
      })
      if (this.activeToolId === id) return
      if (!this.canActivateTool(id)) throw new GISRuntimeError({ code: 'APP_INVALID_STATE', message: `Tool "${id}" is unavailable.`, stage: 'tool-activation' })

      const previousId = this.activeToolId
      const previous = previousId ? this.tools.get(previousId) : undefined
      if (previous) {
        await previous.deactivate?.(this.context)
        this.activeToolId = undefined
        this.events.emit('tool:deactivated', { toolId: previousId! })
      }

      try {
        await next.activate(this.context)
        if (next.mode !== 'action') this.activeToolId = id
        this.events.emit('tool:activated', { toolId: id })
      } catch (cause) {
        try { await next.deactivate?.(this.context) } catch { /* keep activation failure as primary */ }
        throw new GISRuntimeError({
          code: 'APP_INITIALIZATION_FAILED',
          message: `Tool "${id}" failed to activate.`,
          stage: 'tool-activation',
          cause,
        })
      }
    })
  }

  deactivateTool(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.activeToolId) return
      const id = this.activeToolId
      const active = this.tools.get(id)
      await active?.deactivate?.(this.context)
      this.activeToolId = undefined
      this.events.emit('tool:deactivated', { toolId: id })
    })
  }

  getActiveTool(): string | undefined { return this.activeToolId }
  hasTool(id: string): boolean { return this.tools.has(id) }
  canActivateTool(id: string): boolean {
    return ['initializing', 'ready', 'mounted', 'unmounted'].includes(this.dependencies.state.status)
      && this.tools.has(id) && (this.tools.get(id)!.canActivate?.(this.context) ?? true)
  }
  undoActiveTool(): void { if (this.activeToolId && this.canActivateTool(this.activeToolId)) this.tools.get(this.activeToolId)?.undo?.(this.context) }

  private async unregisterTool(id: string, definition: ToolDefinition): Promise<void> {
    if (this.tools.get(id) !== definition) return
    if (this.activeToolId === id) await this.deactivateTool()
    this.tools.delete(id)
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.transition.then(operation)
    this.transition = result.catch(() => undefined)
    return result
  }
}
