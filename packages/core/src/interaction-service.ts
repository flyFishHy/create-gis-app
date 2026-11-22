import { GISRuntimeError } from './errors.js'
import type { InteractionDependencies } from './context/service-dependencies.js'
import { assertRuntimeStatus, writableStatuses } from './runtime/lifecycle.js'
import { assertResourceScopeActive } from './resource-scope.js'
import type {
  AppContext,
  EventService,
  FeaturePickCandidate,
  FeaturePickState,
  FeatureReference,
  InteractionService,
  MapFeaturePick,
  ResourceScope,
  SelectOptions,
  ToolDefinition,
  Unsubscribe,
} from './types.js'

const identifyTimeout = 2000

export class InteractionServiceImpl implements InteractionService {
  private get selection(): FeatureReference | undefined {
    return this.dependencies.state.interactions.selection ?? undefined
  }
  private set selection(selection: FeatureReference | undefined) {
    this.dependencies.state.setInteractions({ selection: selection ?? null })
  }
  private readonly selectionListeners = new Set<(feature: FeatureReference | undefined) => void>()
  private featurePicker?: (pick: FeaturePickState | undefined) => void
  private featurePick?: { controller: AbortController; stop: Unsubscribe; anchoredChoices: boolean }
  private readonly tools = new Map<string, ToolDefinition>()
  private get activeToolId(): string | undefined {
    return this.dependencies.state.interactions.activeToolId ?? undefined
  }
  private set activeToolId(id: string | undefined) {
    this.dependencies.state.setInteractions({ activeToolId: id ?? null })
  }
  private transition: Promise<void> = Promise.resolve()
  private closed = false

  constructor(
    private readonly dependencies: InteractionDependencies,
    private readonly events: EventService
  ) {}
  private get context(): AppContext {
    return this.dependencies.context()
  }

  select(options?: SelectOptions): void {
    assertRuntimeStatus(
      this.dependencies.state.status,
      'change selection',
      'feature-selection',
      options?.feature ? writableStatuses : [...writableStatuses, 'disposing', 'error']
    )
    this.cancelFeaturePick()
    const feature = options?.feature
    this.selection =
      feature && this.context.layers.canSelectFeature(feature)
        ? Object.freeze({
            ...feature,
            properties: feature.properties ? Object.freeze({ ...feature.properties }) : undefined,
          })
        : undefined
    for (const listener of [...this.selectionListeners]) {
      try {
        listener(this.selection)
      } catch (cause) {
        this.events.emit('app:error', {
          error: new GISRuntimeError({
            code: 'APP_INVALID_STATE',
            message: 'Selection observer failed.',
            stage: 'event-listener',
            cause,
          }),
        })
      }
    }
    this.events.emit('feature:selected', { feature: this.selection })
  }

  clearSelection(): void {
    this.select()
  }
  getSelection(): FeatureReference | undefined {
    return this.selection
  }

  onSelect(listener: (feature: FeatureReference | undefined) => void): Unsubscribe {
    if (this.closed) return () => {}
    this.selectionListeners.add(listener)
    return () => this.selectionListeners.delete(listener)
  }

  registerFeaturePicker(listener: (pick: FeaturePickState | undefined) => void): Unsubscribe {
    assertRuntimeStatus(
      this.dependencies.state.status,
      'register a feature picker',
      'feature-picking'
    )
    if (this.featurePicker)
      throw new GISRuntimeError({
        code: 'APP_INVALID_STATE',
        message: 'A feature picker is already registered.',
        stage: 'feature-picking',
      })
    this.featurePicker = listener
    return () => {
      if (this.featurePicker !== listener) return
      this.featurePicker = undefined
      this.cancelFeaturePick()
    }
  }

  cancelFeaturePick(options?: { readonly preserveAnchoredChoices?: boolean }): void {
    const current = this.featurePick
    if (!current || (options?.preserveAnchoredChoices && current.anchoredChoices)) return
    this.featurePick = undefined
    current.stop()
    current.controller.abort()
    this.notifyFeaturePicker(undefined)
  }

  async pickFeatures(pick: MapFeaturePick): Promise<void> {
    if (!writableStatuses.includes(this.dependencies.state.status) || this.activeToolId) return
    this.cancelFeaturePick()
    const controller = new AbortController()
    const { state, layers, map } = this.context
    const start = state.snapshot()
    const current = {
      controller,
      anchoredChoices: false,
      stop: state.subscribe((next) => {
        if (
          next.layers !== start.layers ||
          next.status !== start.status ||
          next.interactions.activeToolId
        ) {
          this.cancelFeaturePick()
          return
        }
        if (next.map === start.map) return
        const sameView =
          next.map.ready === start.map.ready &&
          next.map.projection === start.map.projection &&
          next.map.resolution === start.map.resolution &&
          next.map.zoom === start.map.zoom &&
          next.map.rotation === start.map.rotation
        this.cancelFeaturePick({ preserveAnchoredChoices: sameView })
      }),
    }
    this.featurePick = current

    const queries = new Map<string, Promise<readonly FeaturePickCandidate[]>>()
    const anchor = pick.location && {
      coordinate: pick.location.coordinate,
      projection: pick.location.projection,
    }
    const position = { pixel: pick.pixel, anchor }
    if (pick.location) {
      const query = { ...pick.location, pixel: pick.pixel, signal: controller.signal }
      for (const id of new Set(pick.layerIds)) {
        const result = layers.identify(id, query)
        if (result) queries.set(id, result)
      }
    }

    let candidates = pick.candidates
    let incomplete = false
    if (queries.size) {
      const timeout = setTimeout(() => controller.abort(), identifyTimeout)
      const results = new Map<string, readonly FeaturePickCandidate[]>()
      try {
        const aborted = new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
            once: true,
          })
        })
        this.notifyFeaturePicker({ status: 'loading', ...position })
        await Promise.all(
          [...queries].map(async ([id, query]) => {
            try {
              results.set(id, await Promise.race([query, aborted]))
            } catch {
              incomplete = true
            }
          })
        )
      } finally {
        clearTimeout(timeout)
      }
      if (this.featurePick !== current) return

      const local = new Map<string, FeaturePickCandidate[]>()
      for (const candidate of candidates) {
        if (queries.has(candidate.layerId)) continue
        const hits = local.get(candidate.layerId)
        if (hits) hits.push(candidate)
        else local.set(candidate.layerId, [candidate])
      }
      candidates = [...new Set([...pick.layerIds, ...local.keys()])].flatMap(
        (id) => results.get(id) ?? local.get(id) ?? []
      )
    }

    if (candidates.length > 1 && this.featurePicker) {
      current.anchoredChoices = !!anchor && map.isReady && !!map.getAdapter().addPopupOverlay
      this.notifyFeaturePicker({ status: 'choices', ...position, candidates, incomplete })
    } else if (candidates[0]) {
      const { title: _title, ...feature } = candidates[0]
      this.select({ feature })
    } else if (!incomplete) {
      this.clearSelection()
    } else if (this.featurePicker) {
      this.notifyFeaturePicker({ status: 'failed', ...position })
    } else {
      this.cancelFeaturePick()
    }
  }

  private notifyFeaturePicker(pick: FeaturePickState | undefined): void {
    try {
      this.featurePicker?.(pick)
    } catch (cause) {
      this.events.emit('app:error', {
        error: new GISRuntimeError({
          code: 'APP_INVALID_STATE',
          message: 'Feature picker observer failed.',
          stage: 'feature-picking',
          cause,
        }),
      })
    }
  }

  registerTool(id: string, definition: ToolDefinition, resources: ResourceScope): void {
    assertRuntimeStatus(this.dependencies.state.status, 'register a tool', 'tool-registration')
    assertResourceScopeActive(resources)
    if (!id.trim() || this.tools.has(id) || definition.id !== id) {
      throw new GISRuntimeError({
        code: 'TOOL_DUPLICATE',
        message: `Tool "${id}" is invalid or already registered.`,
        stage: 'tool-registration',
      })
    }
    this.tools.set(id, definition)
    try {
      resources.add(() => this.unregisterTool(id, definition))
    } catch (error) {
      this.tools.delete(id)
      throw error
    }
  }

  activateTool(id: string): Promise<void> {
    return this.enqueue(async () => {
      assertRuntimeStatus(this.dependencies.state.status, 'activate a tool', 'tool-activation')
      const next = this.tools.get(id)
      if (!next)
        throw new GISRuntimeError({
          code: 'TOOL_NOT_FOUND',
          message: `Tool "${id}" was not found.`,
          stage: 'tool-activation',
        })
      if (this.activeToolId === id) return
      if (!this.canActivateTool(id))
        throw new GISRuntimeError({
          code: 'APP_INVALID_STATE',
          message: `Tool "${id}" is unavailable.`,
          stage: 'tool-activation',
        })
      this.cancelFeaturePick()

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
        try {
          await next.deactivate?.(this.context)
        } catch {
          /* keep activation failure as primary */
        }
        throw new GISRuntimeError({
          code: 'TOOL_ACTIVATION_FAILED',
          message: `Tool "${id}" failed to activate.${cause instanceof GISRuntimeError ? ` ${cause.message}` : ''}`,
          stage: 'tool-activation',
          cause,
        })
      }
    })
  }

  deactivateTool(expectedId?: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.activeToolId || (expectedId !== undefined && this.activeToolId !== expectedId))
        return
      const id = this.activeToolId
      const active = this.tools.get(id)
      await active?.deactivate?.(this.context)
      this.activeToolId = undefined
      this.events.emit('tool:deactivated', { toolId: id })
    })
  }

  getActiveTool(): string | undefined {
    return this.activeToolId
  }
  close(): void {
    this.cancelFeaturePick()
    this.featurePicker = undefined
    this.closed = true
    this.selectionListeners.clear()
    this.tools.clear()
    this.dependencies.state.setInteractions({ selection: null, activeToolId: null })
  }
  hasTool(id: string): boolean {
    return this.tools.has(id)
  }
  canActivateTool(id: string): boolean {
    return (
      ['initializing', 'ready', 'mounted', 'unmounted'].includes(this.dependencies.state.status) &&
      this.tools.has(id) &&
      (this.tools.get(id)!.canActivate?.(this.context) ?? true)
    )
  }
  undoActiveTool(): void {
    if (this.activeToolId && this.canActivateTool(this.activeToolId))
      this.tools.get(this.activeToolId)?.undo?.(this.context)
  }

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
