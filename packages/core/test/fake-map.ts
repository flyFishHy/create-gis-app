import type {
  GISPlugin,
  LayerConfig,
  LayerTypeDefinition,
  MapAdapter,
  MapConfig,
  MapLayerHandle,
  MapViewService,
} from '../src/types.js'

export class FakeMapAdapter implements MapAdapter {
  readonly name = 'fake-map'
  created = false
  destroyed = false
  target?: HTMLElement | string
  readonly handles: MapLayerHandle[] = []
  readonly removed: MapLayerHandle[] = []
  readonly view = new FakeMapView()

  create(config: MapConfig = {}): void { this.created = true; this.destroyed = false; this.view.center = config.center; this.view.zoom = config.zoom }
  destroy(): void { this.destroyed = true; this.target = undefined }
  getView(): MapViewService { return this.view }
  getSize(): [number, number] | undefined { return [640, 480] }
  updateSize(): void {}
  setTarget(target: HTMLElement | string | undefined): void { this.target = target }
  addLayer(handle: MapLayerHandle): void { this.handles.push(handle) }
  removeLayer(handle: MapLayerHandle): void {
    this.removed.push(handle)
    const index = this.handles.indexOf(handle)
    if (index >= 0) this.handles.splice(index, 1)
  }
  setLayerOrder(handles: readonly MapLayerHandle[]): void {
    this.handles.splice(0, this.handles.length, ...handles)
  }
}

export class FakeMapView implements MapViewService {
  center?: readonly [number, number]
  zoom?: number
  fittedExtent?: readonly [number, number, number, number]

  getCenter(): readonly [number, number] | undefined { return this.center }
  setCenter(center: readonly [number, number]): void { this.center = center }
  getZoom(): number | undefined { return this.zoom }
  setZoom(zoom: number): void { this.zoom = zoom }
  fit(extent: readonly [number, number, number, number]): void { this.fittedExtent = extent }
}

export function createFakeMapPlugin(
  adapter = new FakeMapAdapter(),
  layerTypes: Record<string, LayerTypeDefinition> = {},
): GISPlugin {
  return {
    name: `fake-map-${Math.random().toString(36).slice(2)}`,
    install(app, _options, resources) {
      app.registerMapAdapter(adapter, resources)
      for (const [type, definition] of Object.entries(layerTypes)) app.registerLayerType(type, definition, resources)
    },
  }
}

export function createFakeLayerDefinition(createHandle: (config: LayerConfig) => MapLayerHandle = () => ({
  setVisible() {},
  setZIndex() {},
  dispose() {},
})): LayerTypeDefinition {
  return { create: (_context, config) => createHandle(config) }
}
