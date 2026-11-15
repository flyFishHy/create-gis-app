import { GISRuntimeError } from './types.js'
import { normalizeLayerLegend } from './config.js'
import type { LayerLegend, LegendDefinition } from './types.js'
import type { ServiceDependencies } from './context/service-dependencies.js'
import type {
  AppContext,
  LayerConfig,
  LayerInstance,
  LayerService,
  LayerTypeDefinition,
  LayerUpdate,
  MapLayerHandle,
  MapService,
  Unsubscribe,
} from './types.js'

type LayerEvent = { type: 'add' | 'remove' | 'update' | 'order' | 'visibility'; id?: string; visible?: boolean }
type LayerListener = (event: LayerEvent) => void

class LayerInstanceImpl implements LayerInstance {
  private currentStatus: LayerInstance['status'] = 'ready'
  private currentVisible: boolean
  private currentTitle?: string
  private disposal?: Promise<void>
  private updates: Promise<void> = Promise.resolve()
  private currentLegend?: LegendDefinition

  constructor(
    readonly id: string,
    readonly type: string,
    title: string | undefined,
    visible: boolean,
    private readonly handle: MapLayerHandle,
    private readonly onDispose: () => Promise<void>,
    private readonly changed: () => void,
    private readonly transact: (operation: () => void) => void,
    private readonly assertMutable: () => void,
    legend?: LayerLegend,
  ) {
    this.currentTitle = title
    this.currentVisible = visible
    this.currentLegend = legend === undefined ? undefined : normalizeLayerLegend(legend, id)
  }

  get title(): string | undefined { return this.currentTitle }
  get status(): LayerInstance['status'] { return this.currentStatus }
  get visible(): boolean { return this.currentVisible }
  get legend(): LegendDefinition | undefined {
    const legend = this.currentLegend
    return legend && this.handle.resolveLegend ? normalizeLayerLegend(this.handle.resolveLegend(legend), this.id) : legend
  }
  settleUpdates(): Promise<void> { return this.updates }

  setVisibility(visible: boolean): void {
    this.assertActive()
    this.transact(() => {
      this.handle.setVisible(visible)
      this.currentVisible = visible
      this.changed()
    })
  }

  update(patch: LayerUpdate): Promise<void> {
    const operation = this.updates.then(() => this.applyUpdate(patch))
    this.updates = operation.catch(() => undefined)
    return operation
  }

  private async applyUpdate(patch: LayerUpdate): Promise<void> {
    this.assertActive()
    const nextLegend = patch.legend === undefined ? this.currentLegend : patch.legend === null ? undefined : normalizeLayerLegend(patch.legend, this.id)
    if (patch.options !== undefined && !this.handle.update) {
      throw new GISRuntimeError({ code: 'CONFIG_INVALID', message: `Layer "${this.id}" does not support options updates.`, stage: 'layer-update' })
    }
    const { legend: _legend, ...enginePatch } = patch
    if (Object.keys(enginePatch).length) await this.handle.update?.(enginePatch)
    this.assertActive()
    this.transact(() => {
      if (patch.visible !== undefined) { this.handle.setVisible(patch.visible); this.currentVisible = patch.visible }
      if (patch.title !== undefined) this.currentTitle = patch.title
      if (patch.zIndex !== undefined) this.handle.setZIndex(patch.zIndex)
      this.currentLegend = nextLegend
      this.changed()
    })
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal
    this.currentStatus = 'disposed'
    // Prevent queued commits immediately, but release the handle only after active work settles.
    this.disposal = this.updates.then(() => this.onDispose())
    this.changed()
    return this.disposal
  }

  getMetadata(): Readonly<Record<string, unknown>> {
    return Object.freeze({ id: this.id, type: this.type, title: this.title, ...this.handle.getMetadata?.() })
  }

  getInternalHandle(): MapLayerHandle { return this.handle }

  private assertActive(): void {
    this.assertMutable()
    if (this.currentStatus === 'disposed') {
      throw new GISRuntimeError({
        code: 'APP_DISPOSED',
        message: `Layer "${this.id}" has been disposed.`,
        stage: 'layer-operation',
      })
    }
  }
}

export class LayerServiceImpl implements LayerService {
  private readonly pending = new Set<string>()
  private readonly tasks = new Set<Promise<LayerInstance>>()
  private readonly definitions = new Map<string, LayerTypeDefinition>()
  private readonly instances = new Map<string, LayerInstanceImpl>()
  private readonly listeners = new Set<LayerListener>()

  constructor(private readonly map: MapService, private readonly dependencies: ServiceDependencies) {}
  private get context(): AppContext { return this.dependencies.context() }
  private changed(): void {
    const selected = this.context.interactions.getSelection()
    const layer = selected && this.instances.get(selected.layerId)
    if (selected && (!selected.source || selected.source === 'layer') && (!layer || !layer.visible || layer.status === 'disposed')) this.context.interactions.clearSelection()
    this.dependencies.state.refresh()
  }

  registerType(type: string, definition: LayerTypeDefinition): void {
    if (!type.trim() || this.definitions.has(type)) {
      throw new GISRuntimeError({
        code: 'LAYER_TYPE_DUPLICATE',
        message: `Layer type "${type}" is invalid or already registered.`,
        stage: 'layer-type-registration',
      })
    }
    this.definitions.set(type, definition)
  }

  unregisterType(type: string, definition: LayerTypeDefinition): void {
    if (this.definitions.get(type) === definition) this.definitions.delete(type)
  }

  async add(config: LayerConfig): Promise<LayerInstance> {
    const task = this.addReserved(config)
    this.tasks.add(task)
    try { return await task } finally { this.tasks.delete(task) }
  }

  async settle(): Promise<void> {
    while (this.tasks.size) await Promise.allSettled([...this.tasks])
    await Promise.all([...this.instances.values()].map(instance => instance.settleUpdates()))
  }

  private async addReserved(config: LayerConfig): Promise<LayerInstance> {
    this.assertCanMutate('add a layer')
    if (this.instances.has(config.id) || this.pending.has(config.id)) {
      throw new GISRuntimeError({
        code: 'LAYER_DUPLICATE',
        message: `Layer "${config.id}" already exists.`,
        stage: 'layer-create',
        detail: { layerId: config.id },
      })
    }
    this.pending.add(config.id)
    try { return await this.createLayer(config) } finally { this.pending.delete(config.id) }
  }

  private async createLayer(config: LayerConfig): Promise<LayerInstance> {
    if (config.legend !== undefined) normalizeLayerLegend(config.legend, config.id)
    if (config.type === 'GROUP') return this.addGroup(config)
    const definition = this.definitions.get(config.type)
    if (!definition) {
      throw new GISRuntimeError({
        code: 'LAYER_TYPE_NOT_FOUND',
        message: `Layer type "${config.type}" is not registered.`,
        stage: 'layer-create',
        detail: { path: `layers.${config.id}.type` },
      })
    }
    const adapter = this.map.getAdapter()
    const handle = await definition.create(this.context, config)
    let attached = false
    try {
      this.assertCanMutate('finish adding a layer')
      if (config.visible === false) handle.setVisible(false)
      if (config.zIndex !== undefined) handle.setZIndex(config.zIndex)
      adapter.addLayer(handle)
      attached = true
      const instance = new LayerInstanceImpl(
        config.id,
        config.type,
        config.title,
        config.visible ?? true,
        handle,
        async () => {
          const errors: unknown[] = []
          try {
            try { adapter.removeLayer(handle) } catch (error) { errors.push(error) }
            try { await handle.dispose() } catch (error) { errors.push(error) }
          } finally {
            this.instances.delete(config.id)
            const selected = this.context.interactions.getSelection()
            if (selected?.layerId === config.id && (!selected.source || selected.source === 'layer')) this.context.interactions.clearSelection()
            this.emit({ type: 'remove', id: config.id })
          }
          if (errors.length) throw new GISRuntimeError({ code: 'APP_DISPOSE_FAILED', message: `Layer "${config.id}" cleanup failed.`, cleanupErrors: errors })
        },
        () => this.changed(),
        operation => this.dependencies.state.batch(operation),
        () => this.assertCanMutate('update a layer'),
        config.legend,
      )
      this.instances.set(config.id, instance)
      this.emit({ type: 'add', id: config.id })
      return instance
    } catch (cause) {
      if (attached) adapter.removeLayer(handle)
      await handle.dispose()
      throw cause
    }
  }

  async remove(id: string): Promise<void> {
    const instance = this.instances.get(id)
    if (!instance) throw this.layerNotFound(id)
    await instance.dispose()
  }

  async update(id: string, patch: LayerUpdate): Promise<void> {
    this.assertCanMutate('update a layer')
    const instance = this.instances.get(id)
    if (!instance) throw this.layerNotFound(id)
    await instance.update(patch)
    this.emit(patch.visible === undefined ? { type: 'update', id } : { type: 'visibility', id, visible: patch.visible })
  }

  get(id: string): LayerInstance | undefined { return this.instances.get(id) }
  has(id: string): boolean { return this.instances.has(id) }
  list(): LayerInstance[] { return [...this.instances.values()] }

  setVisibility(id: string, visible: boolean): void {
    const instance = this.instances.get(id)
    if (!instance) throw this.layerNotFound(id)
    this.dependencies.state.batch(() => instance.setVisibility(visible))
    this.emit({ type: 'visibility', id, visible })
  }

  setOrder(ids: string[]): void {
    const currentIds = [...this.instances.keys()]
    if (ids.length !== currentIds.length || new Set(ids).size !== currentIds.length || ids.some((id) => !this.instances.has(id))) {
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message: 'Layer order must contain each registered layer exactly once.',
        stage: 'layer-order',
        detail: { path: 'layers.order' },
      })
    }
    const adapter = this.map.getAdapter()
    const layerHandles = ids
      .map((id) => this.instances.get(id)!)
      .filter((instance) => instance.type !== 'GROUP')
      .map((instance) => this.getHandle(instance))
    adapter.setLayerOrder(layerHandles)
    const ordered = ids.map(id => this.instances.get(id)!)
    this.instances.clear()
    for (const instance of ordered) this.instances.set(instance.id, instance)
    this.emit({ type: 'order' })
  }

  async clear(): Promise<void> {
    const errors: unknown[] = []
    for (const instance of [...this.instances.values()].reverse()) {
      try { await instance.dispose() } catch (error) { errors.push(error) }
    }
    if (errors.length) {
      throw new GISRuntimeError({
        code: 'APP_DISPOSE_FAILED',
        message: `${errors.length} layer(s) failed to dispose.`,
        stage: 'layer-clear',
        cleanupErrors: errors,
      })
    }
  }

  subscribe(listener: LayerListener): Unsubscribe {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private getHandle(instance: LayerInstanceImpl): MapLayerHandle {
    return instance.getInternalHandle()
  }

  private assertCanMutate(action: string): void {
    const status = this.dependencies.state.status
    if (!['initializing', 'ready', 'mounted', 'unmounted'].includes(status)) {
      throw new GISRuntimeError({
        code: status === 'disposed' || status === 'disposing' ? 'APP_DISPOSED' : 'APP_INVALID_STATE',
        message: `Cannot ${action} while the app is ${status}.`,
        stage: 'layer-operation',
      })
    }
  }

  private async addGroup(config: LayerConfig): Promise<LayerInstance> {
    if (!config.children?.length) {
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message: `Group layer "${config.id}" must contain at least one child.`,
        stage: 'layer-create',
        detail: { path: `layers.${config.id}.children` },
      })
    }
    const children: LayerInstance[] = []
    try {
      for (const child of config.children) children.push(await this.add(child))
      this.assertCanMutate('finish adding a group layer')
    } catch (cause) {
      for (const child of children.reverse()) await this.remove(child.id).catch(() => undefined)
      throw cause
    }

    let visible = config.visible ?? true
    const handle: MapLayerHandle = {
      setVisible: (next) => {
        visible = next
        for (const child of children) if (this.get(child.id) === child) this.setVisibility(child.id, next)
      },
      setZIndex: () => undefined,
      dispose: async () => {
        const errors: unknown[] = []
        for (const child of [...children].reverse()) {
          try { if (this.get(child.id) === child) await this.remove(child.id) } catch (error) { errors.push(error) }
        }
        if (errors.length) throw new GISRuntimeError({
          code: 'APP_DISPOSE_FAILED',
          message: `Group "${config.id}" child cleanup failed.`,
          stage: 'group-dispose',
          cleanupErrors: errors,
        })
      },
      getMetadata: () => ({ childIds: children.filter(child => this.get(child.id) === child).map((child) => child.id) }),
    }
    const group = new LayerInstanceImpl(
      config.id,
      'GROUP',
      config.title,
      visible,
      handle,
      async () => {
        try { await handle.dispose?.() } finally {
          this.instances.delete(config.id)
          this.emit({ type: 'remove', id: config.id })
        }
      },
      () => this.changed(),
      operation => this.dependencies.state.batch(operation),
      () => this.assertCanMutate('update a group layer'),
      config.legend,
    )
    if (!visible) handle.setVisible(false)
    this.instances.set(config.id, group)
    this.emit({ type: 'add', id: config.id })
    return group
  }

  private layerNotFound(id: string): GISRuntimeError {
    return new GISRuntimeError({
      code: 'LAYER_NOT_FOUND',
      message: `Layer "${id}" was not found.`,
      stage: 'layer-operation',
      detail: { layerId: id },
    })
  }

  private emit(event: LayerEvent): void {
    this.changed()
    for (const listener of [...this.listeners]) {
      try { listener(event) } catch (cause) { this.context.events.emit('app:error', { error: new GISRuntimeError({ code: 'APP_INVALID_STATE', message: 'Layer observer failed.', stage: 'event-listener', cause }) }) }
    }
  }
}
