import { GISRuntimeError } from './errors.js'
import type { MapAdapter, MapService, MapViewService, MapLocation } from './types.js'
import type { AppStatus, MapConfig, MapStateSnapshot, Unsubscribe } from './types.js'
import type { AppStateImpl } from './state/app-state.js'
import { assertRuntimeStatus, writableStatuses } from './runtime/lifecycle.js'

export class MapServiceImpl implements MapService {
  private adapter?: MapAdapter
  private ready = false
  private releaseAfterDestroy = false
  private unsubscribeView?: Unsubscribe
  private config: MapConfig = {}
  constructor(private readonly state: Pick<AppStateImpl, 'status' | 'refresh'>) {}
  snapshot(): MapStateSnapshot {
    if (!this.ready) return { ready: false, projection: null, center: null, zoom: null, resolution: null, metersPerPixel: null, rotation: null }
    const view = this.requireAdapter().getView()
    return { ready: true, ...(this.adapter?.getViewState?.() ?? { projection: this.config.projection ?? null,
      center: view.getCenter() ?? null, zoom: view.getZoom() ?? null, resolution: null, metersPerPixel: null, rotation: null }) }
  }

  get isReady(): boolean {
    return this.ready
  }

  get hasAdapter(): boolean { return this.adapter !== undefined }

  registerAdapter(adapter: MapAdapter): void {
    if (this.adapter) {
      throw new GISRuntimeError({
        code: 'APP_INVALID_STATE',
        message: 'Only one Map Adapter can be registered per app.',
        stage: 'adapter-registration',
      })
    }
    this.adapter = adapter
  }

  unregisterAdapter(adapter: MapAdapter): void {
    if (this.adapter !== adapter) return
    // Plugin scopes close before map resources; layer cleanup still needs the adapter.
    if (this.ready) this.releaseAfterDestroy = true
    else this.adapter = undefined
  }

  async create(config: Parameters<MapAdapter['create']>[0]): Promise<void> {
    if (!this.adapter) {
      throw new GISRuntimeError({
        code: 'ADAPTER_MISSING',
        message: 'A Map Adapter is required to initialize map configuration.',
        stage: 'map-create',
      })
    }
    try {
      await this.adapter.create(config)
      this.config = config
      this.ready = true
      this.unsubscribeView = this.adapter.onViewChange?.(() => this.state.refresh())
      this.state.refresh()
    } catch (cause) {
      const cleanupErrors: unknown[] = []
      try { this.unsubscribeView?.() } catch (error) { cleanupErrors.push(error) }
      try { await this.adapter.destroy() } catch (error) { cleanupErrors.push(error) }
      this.unsubscribeView = undefined
      this.ready = false
      this.state.refresh()
      if (cleanupErrors.length) {
        throw new GISRuntimeError({
          code: 'APP_INITIALIZATION_FAILED',
          message: 'Map Adapter creation failed and cleanup also failed.',
          stage: 'map-create',
          cause,
          cleanupErrors,
        })
      }
      throw cause
    }
  }

  async destroy(): Promise<void> {
    if (!this.adapter || !this.ready) return
    const errors: unknown[] = []
    try {
      try { this.unsubscribeView?.() } catch (error) { errors.push(error) }
      try { await this.adapter.destroy() } catch (error) { errors.push(error) }
    } finally {
      this.ready = false
      this.unsubscribeView = undefined
      if (this.releaseAfterDestroy) { this.adapter = undefined; this.releaseAfterDestroy = false }
      this.state.refresh()
    }
    if (errors.length) throw new GISRuntimeError({ code: 'APP_DISPOSE_FAILED', message: 'Map cleanup failed.', stage: 'map-destroy', cleanupErrors: errors })
  }

  getView(): MapViewService {
    const readable: readonly AppStatus[] = [...writableStatuses, 'disposing', 'error']
    this.requireReadyAdapter('read the map view', readable)
    // Resolve on every call: retained facades cannot bypass shutdown checks.
    const view = () => this.requireReadyAdapter('access the map view').getView()
    const read = () => this.requireReadyAdapter('read the map view', readable).getView()
    return { getCenter: () => read().getCenter(), getZoom: () => read().getZoom(),
      setCenter: center => { view().setCenter(center); this.state.refresh() },
      setZoom: zoom => { view().setZoom(zoom); this.state.refresh() },
      fit: extent => { view().fit(extent); this.state.refresh() } }
  }

  locate(location: MapLocation): void {
    const adapter = this.requireReadyAdapter('locate on the map')
    if (location.coordinate && (location.coordinate.length !== 2 || !location.coordinate.every(Number.isFinite))) throw new GISRuntimeError({ code: 'CONFIG_INVALID', message: 'Invalid location coordinate.' })
    if (location.extent && (location.extent.length !== 4 || !location.extent.every(Number.isFinite))) throw new GISRuntimeError({ code: 'CONFIG_INVALID', message: 'Invalid location extent.' })
    if (adapter.locate) adapter.locate(location)
    else {
      if (location.projection && location.projection !== this.snapshot().projection) throw new GISRuntimeError({ code: 'CONFIG_INVALID', message: 'This adapter cannot transform the location projection.' })
      if (location.extent) adapter.getView().fit(location.extent)
      else if (location.coordinate) adapter.getView().setCenter(location.coordinate)
    }
    this.state.refresh()
  }

  getSize(): [number, number] | undefined {
    return this.requireReadyAdapter('read the map size', [...writableStatuses, 'disposing', 'error']).getSize()
  }
  onPointerMove(listener: (coordinate: readonly [number, number] | undefined) => void): Unsubscribe {
    if (!this.ready) return () => {}
    return this.requireAdapter().onPointerMove?.(listener) ?? (() => {})
  }

  updateSize(): void {
    this.requireReadyAdapter('update the map size').updateSize()
  }

  setTarget(target: HTMLElement | string | undefined): void {
    assertRuntimeStatus(this.state.status, 'set the map target', 'map-target', target === undefined
      ? [...writableStatuses, 'disposing', 'error'] : writableStatuses)
    this.requireAdapter().setTarget(target)
  }

  getAdapter(): MapAdapter {
    return this.requireAdapter()
  }

  private requireReadyAdapter(action: string, allowed?: readonly AppStatus[]): MapAdapter {
    assertRuntimeStatus(this.state.status, action, 'map-access', allowed)
    if (!this.ready) throw new GISRuntimeError({ code: 'APP_INVALID_STATE', message: 'Map is not ready.', stage: 'map-access' })
    return this.requireAdapter()
  }

  private requireAdapter(): MapAdapter {
    if (!this.adapter) {
      throw new GISRuntimeError({
        code: 'ADAPTER_MISSING',
        message: 'No Map Adapter is registered.',
        stage: 'map-access',
      })
    }
    return this.adapter
  }
}
