import Feature from 'ol/Feature.js'
import { transform, transformExtent, toLonLat, getPointResolution } from 'ol/proj.js'
import { installOLTools } from './ol-tools.js'
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
import { getUid } from 'ol/util.js'
import { asArray as parseColor } from 'ol/color.js'
import type { SearchResult } from '@joinmap/gis-core'
import type { MapStateSnapshot, Unsubscribe } from '@joinmap/gis-core'
import { defaults as defaultControls } from 'ol/control/defaults.js'
import type {
  GISApp,
  GISPlugin,
  AppContext,
  LayerConfig,
  LayerTimeDimension,
  LayerTimeFilter,
  MapAdapter,
  MapConfig,
  MapLayerHandle,
  MapViewService,
  ResourceScope,
} from '@joinmap/gis-core'

export interface OLAdapterOptions {
  readonly tools?: boolean
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
      if (options.tools !== false) installOLTools(app, resources)
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
    if (location.extent) view.fit(transformExtent([...location.extent], from, projection), { padding: [24, 24, 24, 24], maxZoom: Math.max(view.getZoom() ?? 0, 16) })
    else if (location.coordinate) view.setCenter(transform([...location.coordinate], from, projection))
  }
  readonly name = 'openlayers'
  private unsubscribeLayers?: () => void
  private map?: OlMap
  private readonly layerByHandle = new WeakMap<MapLayerHandle, BaseLayer>()
  private readonly featureFilterByHandle = new WeakMap<MapLayerHandle, (filter: ((feature: Feature) => boolean) | undefined) => void>()
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
    const resolution = view.getResolution()
    const meters = center && resolution !== undefined ? getPointResolution(view.getProjection(), resolution, center, 'm') : NaN
    return { metersPerPixel: Number.isFinite(meters) ? meters : null, projection: view.getProjection().getCode(), center: center ? [center[0]!, center[1]!] : null,
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
  onPointerMove(listener: (coordinate: readonly [number, number] | undefined) => void): Unsubscribe {
    const map = this.requireMap()
    const key = map.on('pointermove', event => {
      if (event.dragging) return
      const position = toLonLat(event.coordinate, map.getView().getProjection())
      listener([position[0]!, position[1]!])
    })
    const leave = () => listener(undefined)
    const viewport = map.getViewport()
    viewport?.addEventListener('pointerleave', leave)
    return () => { unByKey(key); viewport?.removeEventListener('pointerleave', leave) }
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
    const cleanup: (() => void)[] = []
    let handle: MapLayerHandle | undefined
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
      const vectorLayer = new VectorLayer({ source: vectorSource })
      handle = this.createHandle(vectorLayer, config)
      let timeFilter: LayerTimeFilter | undefined
      const timeDimensions = (): readonly LayerTimeDimension[] => detectTimeDimensions(vectorSource.getFeatures())
      const matchesTimeFilter = (feature: Feature): boolean => {
        if (!timeFilter) return true
        const value = timestampValue(feature.get(timeFilter.field), timeFilter.field)
        return value !== undefined && value >= timeFilter.start && value <= timeFilter.end
      }
      handle.getTimeDimensions = timeDimensions
      handle.getFields = () => {
        const fields = new Map<string, 'string' | 'number' | 'boolean'>()
        for (const feature of vectorSource.getFeatures()) for (const [name, value] of Object.entries(feature.getProperties())) {
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') fields.set(name, typeof value as 'string' | 'number' | 'boolean')
        }
        return [...fields].map(([name, type]) => ({ name, type }))
      }
      handle.getTimeFilter = () => timeFilter && { ...timeFilter }
      handle.setTimeFilter = filter => {
        if (filter) {
          const dimension = timeDimensions().find(item => item.field === filter.field)
          if (!dimension) throw new Error(`Layer "${config.id}" has no date/time field "${filter.field}".`)
          timeFilter = Object.freeze({ ...filter })
        } else timeFilter = undefined
        this.featureFilterByHandle.get(handle!)?.(timeFilter ? matchesTimeFilter : undefined)
      }
      const baseMetadata = handle.getMetadata
      handle.getMetadata = () => ({
        ...baseMetadata?.(),
        hasDataLocation: !!vectorSource.getExtent()?.every(Number.isFinite),
        time: {
          dimensions: timeDimensions().map(({ field, values }) => ({ field, count: values.length, min: values[0], max: values.at(-1) })),
          filter: timeFilter ? { ...timeFilter } : null,
        },
      })
      handle.getDataLocation = () => {
        const extent = vectorSource.getExtent()
        if (!extent?.every(Number.isFinite)) return undefined
        const target = this.requireMap().getView().getProjection()
        const bounds = transformExtent(extent, projection, target)
        return { extent: [bounds[0]!, bounds[1]!, bounds[2]!, bounds[3]!], projection: target.getCode() }
      }
      const unvalidate = dataSet.validate(data => { format.readFeatures(data as Record<string, unknown>) })
      cleanup.push(unvalidate)
      const unsubscribe = dataSet.subscribe(data => {
        const next = format.readFeatures(data as Record<string, unknown>)
        vectorSource.clear(); vectorSource.addFeatures(next)
        if (context.interactions.getSelection()?.layerId === config.id) context.interactions.clearSelection()
        // Re-apply the optional filter and publish a layer revision after the
        // source changes so time dimensions and data-derived extents update UI.
        context.layers.get(config.id)?.setTimeFilter(timeFilter)
      })
      cleanup.push(unsubscribe)
      cleanup.push(context.search.registerProvider({
        id: `ol-geojson:${config.id}`,
        layerIds: [config.id],
        async search({ keyword, signal }) {
          const term = keyword.trim().toLocaleLowerCase()
          if (!term) return []
          const results: SearchResult[] = []
          for (const feature of vectorSource.getFeatures()) {
            signal?.throwIfAborted()
            if (!matchesTimeFilter(feature)) continue
            const properties = { ...feature.getProperties() }
            delete properties[feature.getGeometryName()]
            const values = Object.values(properties).filter(value => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
            if (![feature.getId(), ...values].some(value => value !== undefined && String(value).toLocaleLowerCase().includes(term))) continue
            const extent = feature.getGeometry()?.getExtent()
            const location = extent?.every(Number.isFinite) ? extent[0] === extent[2] && extent[1] === extent[3]
              ? { coordinate: [extent[0]!, extent[1]!] as [number, number] }
              : { extent: [extent[0]!, extent[1]!, extent[2]!, extent[3]!] as [number, number, number, number] } : {}
            const title = [properties.name, properties.title, properties.label, ...values, feature.getId()].find(value => value !== undefined && value !== null && String(value).trim())
            results.push({ id: `${config.id}:${feature.getId() ?? getUid(feature)}`, layerId: config.id,
              title: String(title ?? config.title ?? config.id), subtitle: context.layers.get(config.id)?.title ?? config.title,
              projection: projection.getCode(), ...location })
            if (results.length >= 50) break
          }
          return results
        },
      }))
      const dispose = handle.dispose
      handle.dispose = async () => {
        for (const stop of cleanup.splice(0).reverse()) stop()
        await dispose?.()
        if (context.data.get(datasetId)) await context.data.remove(datasetId)
      }
      return handle
    } catch (error) {
      for (const stop of cleanup.reverse()) stop()
      await handle?.dispose?.()
      if (ownsDataSet) await context.data.remove(datasetId).catch(() => undefined)
      throw error
    }
  }

  private createHandle(layer: BaseLayer, config: LayerConfig): MapLayerHandle {
    const defaults = { fillColor: '#ffffff66', strokeColor: '#3399cc', strokeWidth: 1.25, pointRadius: 5 }
    let styleOptions = { ...defaults, ...config.style }
    let legend: LayerConfig['legend'] = config.legend ? JSON.parse(JSON.stringify(config.legend)) : undefined
    let featureFilter: ((feature: Feature) => boolean) | undefined
    let vectorStyle: Style
    const colors = new Map<string, Style>()
    const makeStyle = (options: typeof defaults) => {
      const fill = new Fill({ color: options.fillColor })
      const stroke = new Stroke({ color: options.strokeColor, width: options.strokeWidth })
      return new Style({ fill, stroke, image: new CircleStyle({ radius: options.pointRadius, fill, stroke }) })
    }
    const validateStyle = (options: typeof defaults) => {
      parseColor(options.fillColor); parseColor(options.strokeColor)
      if (!Number.isFinite(options.strokeWidth) || options.strokeWidth <= 0 || !Number.isFinite(options.pointRadius) || options.pointRadius <= 0) throw new Error('Style sizes must be positive.')
    }
    const validateLegend = (value: typeof legend) => {
      if (value?.field && !(layer instanceof VectorLayer)) throw new Error('Field-based legend rules require a vector layer.')
      for (const item of value?.items ?? []) if (item.color) parseColor(item.color)
      for (const range of value?.ranges ?? []) parseColor(range.color)
      if (value?.noData?.color) parseColor(value.noData.color)
    }
    const featureStyle = (feature: Feature) => {
      if (featureFilter && !featureFilter(feature)) return undefined
      if (!legend?.field) return vectorStyle
      const value: unknown = feature.get(legend.field)
      let color: string | undefined
      if (value === null || value === undefined) color = legend.noData?.color
      else if (legend.type === 'category') color = legend.items?.find(item => item.value === value)?.color
      else if (legend.type === 'interval' && typeof value === 'number' && Number.isFinite(value)) {
        color = legend.ranges?.find(range => value >= range.min && (value < range.max || (range.includeMax && value === range.max)))?.color
      }
      if (!color) return vectorStyle
      const line = /LineString$/.test(feature.getGeometry()?.getType() ?? '')
      const key = (line ? 'line:' : 'fill:') + color
      let style = colors.get(key)
      if (!style) { style = makeStyle({ ...styleOptions, [line ? 'strokeColor' : 'fillColor']: color }); colors.set(key, style) }
      return style
    }
    const applyVectorStyle = () => {
      if (!(layer instanceof VectorLayer)) return
      vectorStyle = makeStyle(styleOptions)
      colors.clear()
      layer.setStyle(legend?.field || featureFilter
        ? feature => feature instanceof Feature ? featureStyle(feature) : undefined
        : vectorStyle)
    }
    const validateOptions = (options: Readonly<Record<string, import('@joinmap/gis-core').JsonValue>>) => {
      for (const key of Object.keys(options)) if (key !== 'opacity') throw new Error(`Unsupported OL layer option "${key}". Put style at layer.style.`)
      if (options.opacity !== undefined && (typeof options.opacity !== 'number' || !Number.isFinite(options.opacity) || options.opacity < 0 || options.opacity > 1)) throw new Error('opacity must be a number between 0 and 1.')
    }
    if (config.style && !(layer instanceof VectorLayer)) throw new Error('style requires a vector layer.')
    validateStyle(styleOptions); validateLegend(legend)
    if (config.options) { validateOptions(config.options); if (typeof config.options.opacity === 'number') layer.setOpacity(config.options.opacity) }
    applyVectorStyle()
    layer.set('gisLayerId', config.id)
    let handle: MapLayerHandle
    handle = {
      getStyle: () => layer instanceof VectorLayer ? Object.freeze({ ...styleOptions }) : undefined,
      setVisible: visible => layer.setVisible(visible),
      setZIndex: zIndex => layer.setZIndex(zIndex),
      update: patch => {
        if (patch.style && !(layer instanceof VectorLayer)) throw new Error('style requires a vector layer.')
        const nextStyle = patch.style === undefined ? styleOptions : { ...defaults, ...patch.style }
        const nextLegend = patch.legend === undefined ? legend : patch.legend ?? undefined
        validateStyle(nextStyle); validateLegend(nextLegend)
        if (patch.options) validateOptions(patch.options)
        // Prepare every value before committing any engine mutations.
        styleOptions = nextStyle; legend = nextLegend
        applyVectorStyle()
        if (typeof patch.options?.opacity === 'number') layer.setOpacity(patch.options.opacity)
        if (patch.visible !== undefined) layer.setVisible(patch.visible)
        if (patch.zIndex !== undefined) layer.setZIndex(patch.zIndex)
        if (patch.title !== undefined) layer.set('title', patch.title)
      },
      dispose: () => {
        this.handles.delete(handle)
        if (layer instanceof VectorLayer) layer.getSource()?.clear(true)
      },
      getMetadata: () => ({ olLayerType: layer.constructor.name, opacity: layer.getOpacity(), zIndex: layer.getZIndex() ?? 0,
        geometryType: layer instanceof VectorLayer ? layer.getSource()?.getFeatures()[0]?.getGeometry()?.getType() : undefined }),
      resolveLegend: value => !value.field && value.useLayerStyle && value.type === 'category' && value.items?.length === 1 ? {
        ...value, items: value.items.map(item => ({ ...item, color: item.symbol === 'line' ? styleOptions.strokeColor : styleOptions.fillColor })),
      } : value,
    }
    this.layerByHandle.set(handle, layer)
    if (layer instanceof VectorLayer) this.featureFilterByHandle.set(handle, filter => { featureFilter = filter; applyVectorStyle(); layer.changed() })
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

const DATE_FIELD = /(^|[_-])(date|time|datetime|timestamp|year)([_-]|$)/i
const ISO_DATE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s]\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i

function timestampValue(value: unknown, field: string): number | undefined {
  if (typeof value === 'string') {
    const input = value.trim()
    if (!ISO_DATE.test(input)) return undefined
    const normalized = input.replaceAll('/', '-').replace(' ', 'T')
    const timestamp = Date.parse(/T/.test(normalized) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? `${normalized}Z` : normalized)
    return Number.isFinite(timestamp) ? timestamp : undefined
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || !DATE_FIELD.test(field)) return undefined
  if (Number.isInteger(value) && value >= 1000 && value <= 9999) return Date.UTC(value, 0, 1)
  if (Math.abs(value) >= 1e11) return value
  if (Math.abs(value) >= 1e9) return value * 1000
  return undefined
}

function detectTimeDimensions(features: readonly Feature[]): readonly LayerTimeDimension[] {
  const fields = new Map<string, Set<number>>()
  for (const feature of features) {
    const properties = feature.getProperties()
    for (const [field, value] of Object.entries(properties)) {
      if (field === feature.getGeometryName()) continue
      const timestamp = timestampValue(value, field)
      if (timestamp === undefined) continue
      let values = fields.get(field)
      if (!values) { values = new Set(); fields.set(field, values) }
      values.add(timestamp)
    }
  }
  return [...fields]
    .map(([field, values]) => Object.freeze({ field, values: Object.freeze([...values].sort((a, b) => a - b)) }))
    .sort((a, b) => Number(DATE_FIELD.test(b.field)) - Number(DATE_FIELD.test(a.field)) || a.field.localeCompare(b.field))
}
