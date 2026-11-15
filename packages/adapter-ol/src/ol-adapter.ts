import Feature from 'ol/Feature.js'
import { transform, transformExtent } from 'ol/proj.js'
import type { MapLocation } from '@joinmap/gis-core'
import { featureReferenceKey, type FeatureReferenceResolver } from './feature-reference.js'
import OlMap from 'ol/Map.js'
import View from 'ol/View.js'
import BaseLayer from 'ol/layer/Base.js'
import TileLayer from 'ol/layer/Tile.js'
import VectorLayer from 'ol/layer/Vector.js'
import XYZ from 'ol/source/XYZ.js'
import VectorSource from 'ol/source/Vector.js'
import GeoJSON from 'ol/format/GeoJSON.js'
import Style from 'ol/style/Style.js'
import Stroke from 'ol/style/Stroke.js'
import Fill from 'ol/style/Fill.js'
import CircleStyle from 'ol/style/Circle.js'
import { unByKey } from 'ol/Observable.js'
import type { MapStateSnapshot, Unsubscribe } from '@joinmap/gis-core'
import { defaults as defaultControls } from 'ol/control/defaults.js'
import type {
  GISApp,
  GISPlugin,
  AppContext,
  LayerConfig,
  MapAdapter,
  MapConfig,
  MapLayerHandle,
  MapViewService,
  ResourceScope,
} from '@joinmap/gis-core'

export interface OLAdapterOptions {
  readonly controls?: boolean
  readonly zoomControl?: boolean
  readonly interactions?: boolean
  readonly projection?: string
}

export function createOLAdapter(options: OLAdapterOptions = {}): GISPlugin {
  return {
    name: 'openlayers-adapter',
    install(app, _pluginOptions, resources) {
      const adapter = new OLMapAdapter(options, app)
      app.registerMapAdapter(adapter, resources)
      app.registerLayerType('xyz', createXYZDefinition(adapter), resources)
      app.registerLayerType('geojson', createGeoJSONDefinition(adapter), resources)
    },
  }
}

export function useOLMap(app: GISApp): OlMap {
  const adapter = app.map.getAdapter()
  if (!(adapter instanceof OLMapAdapter)) {
    throw new Error('The registered Map Adapter is not OpenLayers.')
  }
  return adapter.getMap()
}

class OLMapAdapter implements MapAdapter {
  locate(location: MapLocation): void {
    const view = this.map!.getView(), projection = view.getProjection()
    const from = location.projection ?? projection
    if (location.extent) view.fit(transformExtent([...location.extent], from, projection))
    else if (location.coordinate) view.setCenter(transform([...location.coordinate], from, projection))
  }
  readonly name = 'openlayers'
  private unsubscribeLayers?: () => void
  private map?: OlMap
  private readonly layerByHandle = new WeakMap<MapLayerHandle, BaseLayer>()
  private readonly handles = new Set<MapLayerHandle>()

  constructor(private readonly options: OLAdapterOptions, private readonly app: GISApp) {}

  create(config: MapConfig): void {
    if (this.map) throw new Error('OpenLayers map has already been created.')
    const view = new View({
      projection: config.projection ?? this.options.projection ?? 'EPSG:3857',
      center: config.center ? [...config.center] : undefined,
      zoom: config.zoom,
      minZoom: config.minZoom,
      maxZoom: config.maxZoom,
    })
    this.map = new OlMap({
      view,
      controls: this.options.controls === false ? [] : defaultControls({ zoom: this.options.zoomControl ?? true }),
      interactions: this.options.interactions === false ? [] : undefined,
    })
    this.map.on('singleclick', event => {
      if (this.app.interactions.getActiveTool()) return
      const hit = this.map!.forEachFeatureAtPixel(event.pixel, (feature, layer) => {
        if (!(feature instanceof Feature)) return undefined
        const resolve = layer?.get(featureReferenceKey) as FeatureReferenceResolver | undefined
        if (resolve) return resolve(feature)
        const layerId = layer?.get('gisLayerId') as string | undefined
        if (!(feature instanceof Feature) || !layerId || !this.app.layers.has(layerId)) return undefined
        const properties = { ...feature.getProperties() }; delete properties[feature.getGeometryName()]
        return { layerId, id: feature.getId(), geometryType: feature.getGeometry()?.getType(), properties }
      })
      if (hit) this.app.interactions.select({ feature: hit }); else this.app.interactions.clearSelection()
    })
    this.unsubscribeLayers = this.app.layers.subscribe(() => {
      const selection = this.app.interactions.getSelection()
      if (selection && (!selection.source || selection.source === 'layer') && !this.app.layers.get(selection.layerId)?.visible) this.app.interactions.clearSelection()
    })
  }

  destroy(): void {
    if (!this.map) return
    this.unsubscribeLayers?.()
    this.map.setTarget(undefined)
    this.map.setLayers([])
    this.map.dispose()
    this.map = undefined
    this.handles.clear()
  }

  getView(): MapViewService {
    const view = this.requireMap().getView()
    return {
      getCenter: () => {
        const center = view.getCenter()
        return center ? [center[0], center[1]] : undefined
      },
      setCenter: (center) => view.setCenter([center[0], center[1]]),
      getZoom: () => view.getZoom(),
      setZoom: (zoom) => view.setZoom(zoom),
      fit: (extent) => view.fit([...extent]),
    }
  }

  getViewState(): Omit<MapStateSnapshot, 'ready'> {
    const view = this.requireMap().getView()
    const center = view.getCenter()
    return { projection: view.getProjection().getCode(), center: center ? [center[0]!, center[1]!] : null,
      zoom: view.getZoom() ?? null, resolution: view.getResolution() ?? null, rotation: view.getRotation() }
  }
  onViewChange(listener: () => void): Unsubscribe {
    const map = this.requireMap()
    let keys = map.getView().on(['change:center', 'change:resolution', 'change:rotation'], listener)
    const replacement = map.on('change:view', () => {
      unByKey(keys)
      keys = map.getView().on(['change:center', 'change:resolution', 'change:rotation'], listener)
      listener()
    })
    return () => { unByKey(keys); unByKey(replacement) }
  }

  getSize(): [number, number] | undefined {
    const size = this.requireMap().getSize()
    return size ? [size[0], size[1]] : undefined
  }

  updateSize(): void { this.requireMap().updateSize() }

  setTarget(target: HTMLElement | string | undefined): void {
    this.requireMap().setTarget(target)
  }

  addLayer(handle: MapLayerHandle, index?: number): void {
    const layer = this.getLayer(handle)
    const collection = this.requireMap().getLayers()
    if (index === undefined || index >= collection.getLength()) collection.push(layer)
    else collection.insertAt(Math.max(index, 0), layer)
  }

  removeLayer(handle: MapLayerHandle): void {
    const layer = this.layerByHandle.get(handle)
    if (layer) this.requireMap().removeLayer(layer)
    this.handles.delete(handle)
    this.layerByHandle.delete(handle)
  }

  setLayerOrder(handles: readonly MapLayerHandle[]): void {
    const layers = handles.map((handle) => this.getLayer(handle))
    const collection = this.requireMap().getLayers()
    const managed = new Set(layers)
    const positions = collection.getArray().flatMap((layer, index) => managed.has(layer) ? [index] : [])
    for (const layer of layers) collection.remove(layer)
    layers.forEach((layer, index) => collection.insertAt(positions[index] ?? collection.getLength(), layer))
  }

  getMap(): OlMap { return this.requireMap() }

  createTileHandle(config: LayerConfig): MapLayerHandle {
    const source = asObject(config.source)
    const url = source?.url
    if (typeof url !== 'string' || !url.trim()) {
      throw new Error(`Layer "${config.id}" requires source.url.`)
    }
    return this.createHandle(new TileLayer({ source: new XYZ({ url }) }), config)
  }

  async createVectorHandle(context: AppContext, config: LayerConfig): Promise<MapLayerHandle> {
    const source = asObject(config.source)
    if (!source || (source.type !== 'url' && source.type !== 'inline')) {
      throw new Error(`Layer "${config.id}" requires a URL or inline data source.`)
    }
    const datasetId = `layer:${config.id}`
    const ownsDataSet = !context.data.get(datasetId)
    try {
      const dataSet = await context.data.load({
        id: datasetId,
        type: source.type,
        url: typeof source.url === 'string' ? source.url : undefined,
        data: source.data as import('@joinmap/gis-core').JsonValue | undefined,
      }, { id: datasetId })
      const projection = this.requireMap().getView().getProjection()
      const format = new GeoJSON({ featureProjection: projection })
      const features = format.readFeatures(dataSet.data as Record<string, unknown>)
      const vectorSource = new VectorSource({ features })
      const handle = this.createHandle(new VectorLayer({ source: vectorSource }), config)
      const unvalidate = dataSet.validate(data => { format.readFeatures(data as Record<string, unknown>) })
      const unsubscribe = dataSet.subscribe(data => {
        const next = format.readFeatures(data as Record<string, unknown>)
        vectorSource.clear(); vectorSource.addFeatures(next)
        if (context.interactions.getSelection()?.layerId === config.id) context.interactions.clearSelection()
      })
      const dispose = handle.dispose
      handle.dispose = async () => {
        unsubscribe()
        unvalidate()
        await dispose?.()
        if (context.data.get(datasetId)) await context.data.remove(datasetId)
      }
      return handle
    } catch (error) {
      if (ownsDataSet) await context.data.remove(datasetId).catch(() => undefined)
      throw error
    }
  }

  private createHandle(layer: BaseLayer, config: LayerConfig): MapLayerHandle {
    let styleOptions: Record<string, string | number> | undefined
    const applyOptions = (options: Readonly<Record<string, import('@joinmap/gis-core').JsonValue>>) => {
      for (const key of Object.keys(options)) if (key !== 'opacity' && key !== 'style') throw new Error(`Unsupported OL layer option "${key}".`)
      let style: Style | undefined
      let prepared: Record<string, string | number> | undefined
      if (options.style !== undefined) {
        if (!(layer instanceof VectorLayer) || !options.style || typeof options.style !== 'object' || Array.isArray(options.style)) throw new Error('style requires a vector layer and a style object.')
        prepared = { fillColor: '#ffffff66', strokeColor: '#3399cc', strokeWidth: 1.25, pointRadius: 5 }
        for (const [key, value] of Object.entries(options.style)) {
          if (key === 'fillColor' || key === 'strokeColor') {
            if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} must be a color string.`)
          } else if (key === 'strokeWidth' || key === 'pointRadius') {
            if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`${key} must be positive.`)
          } else throw new Error(`Unsupported style option "${key}".`)
          prepared[key] = value
        }
        const fill = new Fill({ color: prepared.fillColor as string })
        const stroke = new Stroke({ color: prepared.strokeColor as string, width: prepared.strokeWidth as number })
        style = new Style({ fill, stroke, image: new CircleStyle({ radius: prepared.pointRadius as number, fill, stroke }) })
      }
      if (options.opacity !== undefined) {
        if (typeof options.opacity !== 'number' || !Number.isFinite(options.opacity) || options.opacity < 0 || options.opacity > 1) throw new Error('opacity must be a number between 0 and 1.')
        layer.setOpacity(options.opacity)
      }
      if (style && layer instanceof VectorLayer) { layer.setStyle(style); styleOptions = prepared }
    }
    if (config.options) applyOptions(config.options)
    layer.set('gisLayerId', config.id)
    let handle: MapLayerHandle
    handle = {
      setVisible: (visible) => layer.setVisible(visible),
      setZIndex: (zIndex) => layer.setZIndex(zIndex),
      update: (patch) => {
        if (patch.options) applyOptions(patch.options)
        if (patch.visible !== undefined) layer.setVisible(patch.visible)
        if (patch.zIndex !== undefined) layer.setZIndex(patch.zIndex)
        if (patch.title !== undefined) layer.set('title', patch.title)
      },
      dispose: () => {
        this.handles.delete(handle)
        if (layer instanceof VectorLayer) layer.getSource()?.clear(true)
      },
      getMetadata: () => ({ olLayerType: layer.constructor.name, opacity: layer.getOpacity(), style: styleOptions ? { ...styleOptions } : undefined }),
      resolveLegend: legend => styleOptions && legend.useLayerStyle && legend.type === 'category' && legend.items?.length === 1 ? {
        ...legend, items: legend.items.map(item => ({ ...item, color: (item.symbol === 'line' ? styleOptions!.strokeColor : styleOptions!.fillColor) as string ?? item.color })),
      } : legend,
    }
    this.layerByHandle.set(handle, layer)
    this.handles.add(handle)
    return handle
  }

  private getLayer(handle: MapLayerHandle): BaseLayer {
    const layer = this.layerByHandle.get(handle)
    if (!layer) throw new Error('Layer handle was not created by this OpenLayers Adapter.')
    return layer
  }

  private requireMap(): OlMap {
    if (!this.map) throw new Error('OpenLayers map has not been initialized.')
    return this.map
  }
}

function createXYZDefinition(adapter: OLMapAdapter) {
  return { create: (_context: unknown, config: LayerConfig) => adapter.createTileHandle(config) }
}

function createGeoJSONDefinition(adapter: OLMapAdapter) {
  return { create: (context: AppContext, config: LayerConfig) => adapter.createVectorHandle(context, config) }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
