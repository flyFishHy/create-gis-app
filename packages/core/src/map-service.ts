import { GISRuntimeError } from './types.js'
import type { MapAdapter, MapService, MapViewService, MapLocation } from './types.js'
import type { MapConfig, MapStateSnapshot, Unsubscribe } from './types.js'
import type { AppStateImpl } from './state/app-state.js'

export class MapServiceImpl implements MapService {
  private adapter?: MapAdapter
  private ready = false
  private unsubscribeView?: Unsubscribe
  private config: MapConfig = {}
  constructor(private readonly state: AppStateImpl) {}
  snapshot(): MapStateSnapshot {
    if (!this.ready) return { ready: false, projection: null, center: null, zoom: null, resolution: null, rotation: null }
    const view = this.requireAdapter().getView()
    return { ready: true, ...(this.adapter?.getViewState?.() ?? { projection: this.config.projection ?? null,
      center: view.getCenter() ?? null, zoom: view.getZoom() ?? null, resolution: null, rotation: null }) }
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
    if (this.adapter === adapter) this.adapter = undefined
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
      try {
        await this.adapter.destroy()
      } catch (cleanupError) {
        throw new GISRuntimeError({
          code: 'APP_INITIALIZATION_FAILED',
          message: 'Map Adapter creation failed and cleanup also failed.',
          stage: 'map-create',
          cause,
          cleanupErrors: [cleanupError],
        })
      }
      throw cause
    }
  }

  async destroy(): Promise<void> {
    if (!this.adapter || !this.ready) return
    try {
      this.unsubscribeView?.()
      await this.adapter.destroy()
    } finally {
      this.ready = false
      this.state.refresh()
    }
  }

  getView(): MapViewService {
    const view = this.requireAdapter().getView()
    return { getCenter: () => view.getCenter(), getZoom: () => view.getZoom(),
      setCenter: center => { view.setCenter(center); this.state.refresh() },
      setZoom: zoom => { view.setZoom(zoom); this.state.refresh() },
      fit: extent => { view.fit(extent); this.state.refresh() } }
  }

  locate(location: MapLocation): void {
    const adapter = this.requireAdapter()
    if (!this.ready) throw new GISRuntimeError({ code: 'APP_INVALID_STATE', message: 'Map is not ready.', stage: 'map-locate' })
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
    return this.requireAdapter().getSize()
  }

  updateSize(): void {
    this.requireAdapter().updateSize()
  }

  setTarget(target: HTMLElement | string | undefined): void {
    this.requireAdapter().setTarget(target)
  }

  getAdapter(): MapAdapter {
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
