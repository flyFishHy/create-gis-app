import { GISRuntimeError } from './types.js'
import { normalizeLayerLegend, normalizeLayerStyle } from './config.js'
import type { LayerLegend, LegendDefinition, MapLocation } from './types.js'
import type { ServiceDependencies } from './context/service-dependencies.js'
import type {
  AppContext,
  LayerConfig,
  LayerStyle,
  LayerInstance,
  LayerService,
  LayerTimeDimension,
  LayerTimeFilter,
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
  private currentStyle?: LayerStyle
  private currentVersion = 0

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
    style?: LayerStyle,
  ) {
    this.currentTitle = title
    this.currentVisible = visible
    this.currentLegend = legend === undefined ? undefined : normalizeLayerLegend(legend, id)
    this.currentStyle = style === undefined ? undefined : normalizeLayerStyle(style)
  }

  get title(): string | undefined { return this.currentTitle }
  get style(): LayerStyle | undefined { return this.handle.getStyle?.() ?? this.currentStyle }
  getFields() { return this.handle.getFields?.() ?? [] }
  getFieldValues(field: string) {
    if (this.currentStatus === 'disposed') return []
    return Object.freeze([...new Set((this.handle.getFieldValues?.(field) ?? []).filter(value =>
      typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))))])
  }
  get version(): number { return this.currentVersion }
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
      this.currentVersion++
      this.changed()
    })
  }

  getTimeDimensions(): readonly LayerTimeDimension[] {
    if (this.currentStatus === 'disposed') return []
    return this.handle.getTimeDimensions?.() ?? []
  }

  getTimeFilter(): LayerTimeFilter | undefined {
    if (this.currentStatus === 'disposed') return undefined
    return this.handle.getTimeFilter?.()
  }

  setTimeFilter(filter: LayerTimeFilter | undefined): void {
    this.assertActive()
    if (!this.handle.setTimeFilter) {
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message: `Layer "${this.id}" does not support time filtering.`,
        stage: 'layer-operation',
      })
    }
    if (filter && (!filter.field.trim() || !Number.isFinite(filter.start) || !Number.isFinite(filter.end) || filter.start > filter.end)) {
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message: `Layer "${this.id}" received an invalid time filter.`,
        stage: 'layer-operation',
      })
    }
    this.transact(() => {
      this.handle.setTimeFilter!(filter)
      this.currentVersion++
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
    if (patch.expectedVersion !== undefined && patch.expectedVersion !== this.currentVersion) {
      throw new GISRuntimeError({ code: 'APP_INVALID_STATE', message: 'Layer changed since editing began. Reload before applying.', stage: 'layer-update' })
    }
    const nextLegend = patch.legend === undefined ? this.currentLegend : patch.legend === null ? undefined : normalizeLayerLegend(patch.legend, this.id)
    const nextStyle = patch.style === undefined ? this.currentStyle : normalizeLayerStyle(patch.style)
    if (patch.options?.style !== undefined) throw new GISRuntimeError({ code: 'CONFIG_INVALID', message: 'Move options.style to layer.style.', stage: 'layer-update' })
    if ((patch.options !== undefined || patch.style !== undefined) && !this.handle.update) {
      throw new GISRuntimeError({ code: 'CONFIG_INVALID', message: `Layer "${this.id}" does not support options updates.`, stage: 'layer-update' })
    }
    const { expectedVersion: _expectedVersion, ...rest } = patch
    const enginePatch = { ...rest, ...(patch.legend !== undefined ? { legend: nextLegend ?? null } : {}), ...(patch.style !== undefined ? { style: nextStyle } : {}) }
    if (Object.keys(enginePatch).length) await this.handle.update?.(enginePatch)
    this.assertActive()
    this.transact(() => {
      if (patch.visible !== undefined) { this.handle.setVisible(patch.visible); this.currentVisible = patch.visible }
      if (patch.title !== undefined) this.currentTitle = patch.title
      if (patch.zIndex !== undefined) this.handle.setZIndex(patch.zIndex)
      this.currentLegend = nextLegend
      this.currentStyle = nextStyle
      this.currentVersion++
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
    if (config.legend !== undefined) config = { ...config, legend: normalizeLayerLegend(config.legend, config.id) }
    if (config.style !== undefined) normalizeLayerStyle(config.style)
    if (config.options?.style !== undefined) throw new GISRuntimeError({ code: 'CONFIG_INVALID', message: 'Move options.style to layer.style.', stage: 'layer-create' })
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
        config.style,
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

  getDataLocation(id: string): MapLocation | undefined {
    const instance = this.instances.get(id)
    if (!instance) throw this.layerNotFound(id)
    if (instance.status === 'disposed') return undefined
    const location = instance.getInternalHandle().getDataLocation?.()
    if (!location) return undefined
    if (location.extent) {
      const [minX, minY, maxX, maxY] = location.extent
      if (location.extent.length !== 4 || !location.extent.every(Number.isFinite) || minX > maxX || minY > maxY) return undefined
      return minX === maxX && minY === maxY
        ? { coordinate: [minX, minY], projection: location.projection }
        : { extent: [minX, minY, maxX, maxY], projection: location.projection }
    }
    return location.coordinate?.length === 2 && location.coordinate.every(Number.isFinite)
      ? { coordinate: [location.coordinate[0], location.coordinate[1]], projection: location.projection } : undefined
  }

  setVisibility(id: string, visible: boolean): void {
    const instance = this.instances.get(id)
    if (!instance) throw this.layerNotFound(id)
    this.dependencies.state.batch(() => instance.setVisibility(visible))
    this.emit({ type: 'visibility', id, visible })
  }

  setOrder(ids: string[]): void {
    this.assertCanMutate('order layers')
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
    // An explicit order takes precedence over earlier per-layer zIndex values.
    layerHandles.forEach((handle, index) => handle.setZIndex(index))
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
    const groupLeaves = (): LayerInstanceImpl[] => {
      const collect = (items: LayerInstance[]): LayerInstanceImpl[] => items.flatMap(child => {
        if (this.get(child.id) !== child) return []
        if (child.type !== 'GROUP') return [child as LayerInstanceImpl]
        const ids = child.getMetadata().childIds
        return collect(Array.isArray(ids) ? ids.flatMap(id => { const current = this.get(String(id)); return current ? [current] : [] }) : [])
      })
      return collect(children)
    }
    const handle: MapLayerHandle = {
      getDataLocation: () => {
        const locations = children.filter(child => this.get(child.id) === child)
          .flatMap(child => { const location = this.getDataLocation(child.id); return location ? [location] : [] })
        if (!locations.length) return undefined
        const projection = locations[0]!.projection ?? this.context.state.snapshot().map.projection ?? undefined
        if (locations.some(location => (location.projection ?? this.context.state.snapshot().map.projection ?? undefined) !== projection)) {
          throw new GISRuntimeError({ code: 'CONFIG_INVALID', message: 'Group data locations must use the same projection.', stage: 'layer-location' })
        }
        const bounds = locations.map(location => location.extent ?? [location.coordinate![0], location.coordinate![1], location.coordinate![0], location.coordinate![1]])
        return { extent: [Math.min(...bounds.map(b => b[0]!)), Math.min(...bounds.map(b => b[1]!)), Math.max(...bounds.map(b => b[2]!)), Math.max(...bounds.map(b => b[3]!))], projection }
      },
      setVisible: (next) => {
        visible = next
        for (const child of children) if (this.get(child.id) === child) this.setVisibility(child.id, next)
      },
      setZIndex: value => {
        const leaves = groupLeaves().sort((a, b) => Number(a.getMetadata().zIndex ?? 0) - Number(b.getMetadata().zIndex ?? 0))
        leaves.forEach((leaf, index) => leaf.getInternalHandle().setZIndex(value + index / leaves.length))
      },
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
      getMetadata: () => {
        const leaves = groupLeaves()
        return { childIds: children.filter(child => this.get(child.id) === child).map(child => child.id), zIndex: leaves.length ? Math.max(...leaves.map(leaf => Number(leaf.getMetadata().zIndex ?? 0))) : config.zIndex ?? 0 }
      },
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
    if (config.zIndex !== undefined) handle.setZIndex(config.zIndex)
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
