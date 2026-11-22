import Feature, { type FeatureLike } from 'ol/Feature.js'
import {
  fromUserCoordinate,
  toUserCoordinate,
  transform,
  transformExtent,
  toLonLat,
  getPointResolution,
} from 'ol/proj.js'
import { installOLTools } from './ol-tools.js'
import type { MapLocation } from '@joinmap/gis-core'
import {
  describeFeature,
  featureReferenceKey,
  findVectorFeature,
  type FeatureReferenceResolver,
} from './feature-reference.js'
import { OLSelectionHighlight } from './selection-highlight.js'
import OlMap from 'ol/Map.js'
import Overlay from 'ol/Overlay.js'
import View from 'ol/View.js'
import BaseLayer from 'ol/layer/Base.js'
import { inView } from 'ol/layer/Layer.js'
import { containsCoordinate } from 'ol/extent.js'
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
import { asArray as parseColor } from 'ol/color.js'
import type { SearchResult } from '@joinmap/gis-core'
import type { MapStateSnapshot, Unsubscribe } from '@joinmap/gis-core'
import { defaults as defaultControls } from 'ol/control/defaults.js'
import { defaults as defaultInteractions } from 'ol/interaction/defaults.js'
import type {
  GISApp,
  GISPlugin,
  AppContext,
  FeaturePickCandidate,
  LayerConfig,
  LayerTimeDimension,
  LayerTimeFilter,
  MapAdapter,
  MapConfig,
  MapLayerHandle,
  MapOverlayAnchor,
  MapViewService,
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
      if (options.tools !== false)
        installOLTools(app, resources, (id) => adapter.getWritableVectorLayer(id))
    },
  }
}

export function useOLMap(app: GISApp): OlMap {
  return getOLAdapter(app).getMap()
}

/** Create a handle for a custom OL layer registered through LayerService. */
export function createOLLayerHandle(
  context: Pick<AppContext, 'map'>,
  layer: BaseLayer,
  config: LayerConfig
): MapLayerHandle {
  return getOLAdapter(context).createHandle(layer, config)
}

function getOLAdapter(context: Pick<AppContext, 'map'>): OLMapAdapter {
  const adapter = context.map.getAdapter()
  if (!(adapter instanceof OLMapAdapter)) {
    throw new Error('The registered Map Adapter is not OpenLayers.')
  }
  return adapter
}

class OLMapAdapter implements MapAdapter {
  locate(location: MapLocation): void {
    const view = this.map!.getView(),
      projection = view.getProjection()
    const from = location.projection ?? projection
    if (location.extent)
      view.fit(transformExtent([...location.extent], from, projection), {
        padding: [24, 24, 24, 24],
        maxZoom: Math.max(view.getZoom() ?? 0, 16),
      })
    else if (location.coordinate)
      view.setCenter(transform([...location.coordinate], from, projection))
  }
  readonly name = 'openlayers'
  private unsubscribeLayers?: () => void
  private map?: OlMap
  private selectionHighlight?: OLSelectionHighlight
  private readonly layerByHandle = new WeakMap<MapLayerHandle, BaseLayer>()
  private readonly inlineVectorLayers = new WeakSet<BaseLayer>()
  private readonly featureFilterByHandle = new WeakMap<
    MapLayerHandle,
    (filter: ((feature: Feature) => boolean) | undefined) => void
  >()
  private readonly matchesLegendByHandle = new WeakMap<
    MapLayerHandle,
    (feature: Feature) => boolean
  >()
  private readonly handles = new Set<MapLayerHandle>()
  private readonly popupCleanups = new Set<Unsubscribe>()

  constructor(
    private readonly options: OLAdapterOptions,
    private readonly app: GISApp
  ) {}

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
      controls:
        this.options.controls === false
          ? []
          : defaultControls({ zoom: this.options.zoomControl ?? true }),
      interactions:
        this.options.interactions === false ? [] : defaultInteractions({ onFocusOnly: false }),
    })
    const map = this.map
    const highlight = (this.selectionHighlight = new OLSelectionHighlight(map, this.app))
    map.on('singleclick', (event) => {
      if (this.app.interactions.getActiveTool()) return
      const candidates: FeaturePickCandidate[] = []
      const seen = new Map<string, Set<FeatureLike | string | number>>()
      const hitLayerIds = new Map<BaseLayer, string>()
      map.forEachFeatureAtPixel(
        event.pixel,
        (feature, layer) => {
          if (!layer) return
          const candidate = this.resolveHit(feature, layer)
          if (!candidate) return
          let features = seen.get(candidate.layerId)
          if (!features) {
            features = new Set()
            seen.set(candidate.layerId, features)
          }
          const key = candidate.id ?? feature
          if (features.has(key)) return
          features.add(key)
          hitLayerIds.set(layer, candidate.layerId)
          candidates.push(candidate)
        },
        { layerFilter: (layer) => layer !== highlight.layer }
      )

      const view = map.getView(),
        projection = view.getProjection(),
        resolution = view.getResolution()
      const coordinate = event.coordinate && fromUserCoordinate(event.coordinate, projection)
      const location =
        coordinate && resolution !== undefined
          ? {
              coordinate: [coordinate[0]!, coordinate[1]!] as [number, number],
              projection: projection.getCode(),
              resolution,
            }
          : undefined
      const viewState = location && view.getState()
      const layerIds = location
        ? map
            .getLayerGroup()
            .getLayerStatesArray()
            .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
            .reverse()
            .flatMap((state) => {
              const id =
                hitLayerIds.get(state.layer) ??
                (state.layer.get('gisLayerId') as string | undefined)
              return id &&
                viewState &&
                inView(state, viewState) &&
                (!state.extent || containsCoordinate(state.extent, location.coordinate))
                ? [id]
                : []
            })
        : []
      void this.app.interactions.pickFeatures({
        pixel: [event.pixel[0]!, event.pixel[1]!],
        location,
        layerIds,
        candidates,
      })
    })
    map.on(['pointerdrag', 'movestart', 'change:size'], () =>
      this.app.interactions.cancelFeaturePick({ preserveAnchoredChoices: true })
    )
    map.on('change:view', () => this.app.interactions.cancelFeaturePick())
    this.unsubscribeLayers = this.app.layers.subscribe(() => {
      const selection = this.app.interactions.getSelection()
      if (
        selection &&
        (!selection.source || selection.source === 'layer') &&
        !this.app.layers.get(selection.layerId)?.visible
      )
        this.app.interactions.clearSelection()
    })
  }

  private resolveHit(feature: FeatureLike, layer: BaseLayer): FeaturePickCandidate | undefined {
    const resolve = layer.get(featureReferenceKey) as FeatureReferenceResolver | undefined
    if (resolve && feature instanceof Feature) return resolve(feature)
    const layerId = layer.get('gisLayerId') as string | undefined
    if (!layerId || !this.app.layers.get(layerId)?.visible) return
    return describeFeature(feature, layerId)
  }

  destroy(): void {
    if (!this.map) return
    this.unsubscribeLayers?.()
    this.selectionHighlight?.dispose()
    this.selectionHighlight = undefined
    for (const cleanup of this.popupCleanups) cleanup()
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
    const meters =
      center && resolution !== undefined
        ? getPointResolution(view.getProjection(), resolution, center, 'm')
        : NaN
    return {
      metersPerPixel: Number.isFinite(meters) ? meters : null,
      projection: view.getProjection().getCode(),
      center: center ? [center[0]!, center[1]!] : null,
      zoom: view.getZoom() ?? null,
      resolution: view.getResolution() ?? null,
      rotation: view.getRotation(),
    }
  }
  onViewChange(listener: () => void): Unsubscribe {
    const map = this.requireMap()
    let frame: number | undefined
    const schedule = () => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        listener()
      })
    }
    let keys = map.getView().on(['change:center', 'change:resolution', 'change:rotation'], schedule)
    const replacement = map.on('change:view', () => {
      unByKey(keys)
      keys = map.getView().on(['change:center', 'change:resolution', 'change:rotation'], schedule)
      schedule()
    })
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      unByKey(keys)
      unByKey(replacement)
    }
  }

  getSize(): [number, number] | undefined {
    const size = this.requireMap().getSize()
    return size ? [size[0], size[1]] : undefined
  }

  addPopupOverlay(element: HTMLElement, anchor: MapOverlayAnchor): Unsubscribe {
    const map = this.requireMap()
    const projection = map.getView().getProjection()
    const position = toUserCoordinate(
      transform([...anchor.coordinate], anchor.projection ?? projection, projection),
      projection
    )
    const overlay = new Overlay({ element, autoPan: false, stopEvent: true, insertFirst: false })
    map.addOverlay(overlay)
    overlay.setPosition(position)

    const margin = 8,
      gap = 10
    const clamp = (value: number, available: number, length: number) =>
      Math.max(margin, Math.min(value, available - margin - length))
    let lastSize: number[] | undefined
    const place = () => {
      const size = map.getSize()
      if (!size) return
      const [width, height] = size as [number, number]
      if (width !== lastSize?.[0] || height !== lastSize[1]) {
        element.style.setProperty(
          '--gis-map-popup-max-width',
          `${Math.max(0, width - 2 * margin)}px`
        )
        element.style.setProperty(
          '--gis-map-popup-max-height',
          `${Math.max(0, height - 2 * margin)}px`
        )
        lastSize = [width, height]
      }
      const pixel = map.getPixelFromCoordinate(position, { wrapX: true })
      if (!pixel) return
      const [x, y] = pixel as [number, number]
      const visible = x >= 0 && x <= width && y >= 0 && y <= height
      element.style.visibility = visible ? '' : 'hidden'
      if (!visible) return

      const { offsetWidth, offsetHeight } = element
      const above = y - gap - offsetHeight
      const top = above >= margin || y > height / 2 ? above : y + gap
      const dx = Math.round(clamp(x - offsetWidth / 2, width, offsetWidth) - x)
      const dy = Math.round(clamp(top, height, offsetHeight) - y)
      element.style.setProperty('--gis-ui-map-popup-anchor-x', `${-dx}px`)
      element.dataset.popupTail = dy >= 0 ? 'top' : dy + offsetHeight <= 0 ? 'bottom' : 'none'
      const [lastX, lastY] = overlay.getOffset()
      if (dx !== lastX || dy !== lastY) overlay.setOffset([dx, dy])
    }
    const key = map.on('postrender', place)
    const observer = new ResizeObserver(place)
    observer.observe(element)
    place()

    const cleanup = () => {
      if (!this.popupCleanups.delete(cleanup)) return
      observer.disconnect()
      unByKey(key)
      map.removeOverlay(overlay)
      overlay.setElement(undefined)
    }
    this.popupCleanups.add(cleanup)
    return cleanup
  }

  onPointerMove(
    listener: (coordinate: readonly [number, number] | undefined) => void
  ): Unsubscribe {
    const map = this.requireMap()
    const key = map.on('pointermove', (event) => {
      if (event.dragging) return
      const position = toLonLat(event.coordinate, map.getView().getProjection())
      listener([position[0]!, position[1]!])
    })
    const leave = () => listener(undefined)
    const viewport = map.getViewport()
    viewport?.addEventListener('pointerleave', leave)
    return () => {
      unByKey(key)
      viewport?.removeEventListener('pointerleave', leave)
    }
  }

  updateSize(): void {
    this.requireMap().updateSize()
  }

  setTarget(target: HTMLElement | string | undefined): void {
    this.app.interactions.cancelFeaturePick()
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
    const positions = collection
      .getArray()
      .flatMap((layer, index) => (managed.has(layer) ? [index] : []))
    for (const layer of layers) collection.remove(layer)
    layers.forEach((layer, index) =>
      collection.insertAt(positions[index] ?? collection.getLength(), layer)
    )
  }

  getMap(): OlMap {
    return this.requireMap()
  }

  getWritableVectorLayer(id: string): VectorLayer<VectorSource> | undefined {
    const layer = this.requireMap()
      .getLayers()
      .getArray()
      .find((item) => item.get('gisLayerId') === id)
    return layer instanceof VectorLayer && this.inlineVectorLayers.has(layer) ? layer : undefined
  }

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
      const dataSet = await context.data.load(
        {
          id: datasetId,
          type: source.type,
          url: typeof source.url === 'string' ? source.url : undefined,
          data: source.data as import('@joinmap/gis-core').JsonValue | undefined,
        },
        { id: datasetId }
      )
      const projection = this.requireMap().getView().getProjection()
      const format = new GeoJSON({ featureProjection: projection })
      const features = format.readFeatures(dataSet.data as Record<string, unknown>)
      const vectorSource = new VectorSource({ features })
      const vectorLayer = new VectorLayer({ source: vectorSource })
      if (source.type === 'inline') this.inlineVectorLayers.add(vectorLayer)
      handle = this.createHandle(vectorLayer, config)
      let timeFilter: LayerTimeFilter | undefined
      let cachedDimensions: readonly LayerTimeDimension[] | undefined
      let cachedSummary:
        | {
            geometryType?: string
            hasDataLocation: boolean
            dimensions: {
              field: string
              count: number
              min: number | undefined
              max: number | undefined
            }[]
          }
        | undefined
      const invalidateDimensions = vectorSource.on('change', () => {
        cachedDimensions = undefined
        cachedSummary = undefined
      })
      cleanup.push(() => unByKey(invalidateDimensions))
      const timeDimensions = (): readonly LayerTimeDimension[] =>
        (cachedDimensions ??= Object.freeze(detectTimeDimensions(vectorSource.getFeatures())))
      const matchesTimeFilter = (feature: Feature): boolean => {
        if (!timeFilter) return true
        const value = timestampValue(feature.get(timeFilter.field), timeFilter.field)
        return value !== undefined && value >= timeFilter.start && value <= timeFilter.end
      }
      handle.getTimeDimensions = timeDimensions
      handle.getFields = () => {
        const fields = new Map<string, 'string' | 'number' | 'boolean'>()
        for (const feature of vectorSource.getFeatures())
          for (const [name, value] of Object.entries(feature.getProperties())) {
            if (
              typeof value === 'string' ||
              typeof value === 'number' ||
              typeof value === 'boolean'
            )
              fields.set(name, typeof value as 'string' | 'number' | 'boolean')
          }
        return [...fields].map(([name, type]) => ({ name, type }))
      }
      handle.getFieldValues = (field) => [
        ...new Set(
          vectorSource.getFeatures().flatMap((feature) => {
            const value: unknown = feature.get(field)
            return typeof value === 'string' ||
              typeof value === 'boolean' ||
              (typeof value === 'number' && Number.isFinite(value))
              ? [value]
              : []
          })
        ),
      ]
      handle.getTimeFilter = () => timeFilter && { ...timeFilter }
      handle.setTimeFilter = (filter) => {
        if (filter) {
          const dimension = timeDimensions().find((item) => item.field === filter.field)
          if (!dimension)
            throw new Error(`Layer "${config.id}" has no date/time field "${filter.field}".`)
          timeFilter = Object.freeze({ ...filter })
        } else timeFilter = undefined
        this.featureFilterByHandle.get(handle!)?.(timeFilter ? matchesTimeFilter : undefined)
      }
      const baseMetadata = handle.getMetadata
      handle.getMetadata = () => {
        cachedSummary ??= {
          geometryType: vectorSource.getFeatures()[0]?.getGeometry()?.getType(),
          hasDataLocation: !!vectorSource.getExtent()?.every(Number.isFinite),
          dimensions: timeDimensions().map(({ field, values }) => ({
            field,
            count: values.length,
            min: values[0],
            max: values.at(-1),
          })),
        }
        return {
          ...baseMetadata?.(),
          geometryType: cachedSummary.geometryType,
          hasDataLocation: cachedSummary.hasDataLocation,
          time: {
            dimensions: cachedSummary.dimensions.map((item) => ({ ...item })),
            filter: timeFilter ? { ...timeFilter } : null,
          },
        }
      }
      handle.getDataLocation = () => {
        const extent = vectorSource.getExtent()
        if (!extent?.every(Number.isFinite)) return undefined
        const target = this.requireMap().getView().getProjection()
        const bounds = transformExtent(extent, projection, target)
        return {
          extent: [bounds[0]!, bounds[1]!, bounds[2]!, bounds[3]!],
          projection: target.getCode(),
        }
      }
      const unvalidate = dataSet.validate((data) => {
        format.readFeatures(data as Record<string, unknown>)
      })
      cleanup.push(unvalidate)
      const unsubscribe = dataSet.subscribe((data) => {
        const next = format.readFeatures(data as Record<string, unknown>)
        vectorSource.clear()
        vectorSource.addFeatures(next)
        const selected = context.interactions.getSelection()
        if (selected?.layerId === config.id && (!selected.source || selected.source === 'layer'))
          context.interactions.clearSelection()
        // Re-apply the optional filter and publish a layer revision after the
        // source changes so time dimensions and data-derived extents update UI.
        const previousFilter = timeFilter
        const nextFilter =
          previousFilter &&
          timeDimensions().some((dimension) => dimension.field === previousFilter.field)
            ? previousFilter
            : undefined
        context.layers.get(config.id)?.setTimeFilter(nextFilter)
      })
      cleanup.push(unsubscribe)
      const matchesLegend = this.matchesLegendByHandle.get(handle)
      cleanup.push(
        context.search.registerProvider({
          id: `ol-geojson:${config.id}`,
          layerIds: [config.id],
          async search({ keyword, signal }) {
            const term = keyword.trim().toLocaleLowerCase()
            if (!term) return []
            const results: SearchResult[] = []
            for (const feature of vectorSource.getFeatures()) {
              signal?.throwIfAborted()
              if (!matchesTimeFilter(feature) || matchesLegend?.(feature) === false) continue
              const reference = describeFeature(feature, config.id)
              const properties = reference.properties ?? {}
              const values = Object.values(properties).filter(
                (value) =>
                  typeof value === 'string' ||
                  typeof value === 'number' ||
                  typeof value === 'boolean'
              )
              if (
                ![feature.getId(), ...values].some(
                  (value) => value !== undefined && String(value).toLocaleLowerCase().includes(term)
                )
              )
                continue
              const extent = feature.getGeometry()?.getExtent()
              const location = extent?.every(Number.isFinite)
                ? extent[0] === extent[2] && extent[1] === extent[3]
                  ? { coordinate: [extent[0]!, extent[1]!] as [number, number] }
                  : {
                      extent: [extent[0]!, extent[1]!, extent[2]!, extent[3]!] as [
                        number,
                        number,
                        number,
                        number,
                      ],
                    }
                : {}
              const title = [
                properties.name,
                properties.title,
                properties.label,
                ...values,
                feature.getId(),
              ].find((value) => value !== undefined && value !== null && String(value).trim())
              results.push({
                id: `${config.id}:${reference.id ?? reference.featureKey}`,
                layerId: config.id,
                feature: reference,
                title: String(title ?? config.title ?? config.id),
                subtitle: context.layers.get(config.id)?.title ?? config.title,
                projection: projection.getCode(),
                ...location,
              })
              if (results.length >= 50) break
            }
            return results
          },
        })
      )
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

  createHandle(layer: BaseLayer, config: LayerConfig): MapLayerHandle {
    const defaults = {
      fillColor: '#ffffff66',
      strokeColor: '#3399cc',
      strokeWidth: 1.25,
      pointRadius: 5,
    }
    let styleOptions = { ...defaults, ...config.style }
    let legend: LayerConfig['legend'] = config.legend
      ? JSON.parse(JSON.stringify(config.legend))
      : undefined
    let legendFilter: string | undefined
    let featureFilter: ((feature: Feature) => boolean) | undefined
    let vectorStyle: Style
    const colors = new Map<string, Style>()
    const enumRules = new Map<
      import('@joinmap/gis-core').LegendValue,
      { id: string; color?: string }
    >()
    const makeStyle = (options: typeof styleOptions) => {
      const { fillOpacity = 1, lineDash, lineCap } = options
      const color = options.fillColor
      const rgba = fillOpacity === 1 ? color : [...parseColor(color)]
      if (typeof rgba !== 'string') rgba[3] = (rgba[3] ?? 1) * fillOpacity
      const fill = new Fill({ color: rgba })
      const stroke = new Stroke({
        color: options.strokeColor,
        width: options.strokeWidth,
        lineCap,
        lineDash: lineDash === 'dashed' ? [8, 5] : lineDash === 'dotted' ? [1, 4] : undefined,
      })
      return new Style({
        fill,
        stroke,
        image: new CircleStyle({ radius: options.pointRadius, fill, stroke }),
      })
    }
    const validateStyle = (options: typeof defaults) => {
      parseColor(options.fillColor)
      parseColor(options.strokeColor)
      if (
        !Number.isFinite(options.strokeWidth) ||
        options.strokeWidth <= 0 ||
        !Number.isFinite(options.pointRadius) ||
        options.pointRadius <= 0
      )
        throw new Error('Style sizes must be positive.')
    }
    const validateLegend = (value: typeof legend) => {
      if (value?.field && !(layer instanceof VectorLayer))
        throw new Error('Field-based legend rules require a vector layer.')
      for (const item of value?.items ?? []) if (item.color) parseColor(item.color)
      for (const range of value?.ranges ?? []) parseColor(range.color)
      if (value?.noData?.color) parseColor(value.noData.color)
    }
    const ruleFor = (feature: Feature) => {
      if (!legend?.field) return undefined
      const value: unknown = feature.get(legend.field)
      if (value === null || value === undefined) return legend.noData
      if (legend.type === 'category')
        return enumRules.get(value as import('@joinmap/gis-core').LegendValue)
      if (legend.type === 'interval' && typeof value === 'number' && Number.isFinite(value)) {
        return legend.ranges?.find(
          (range) =>
            value >= range.min && (value < range.max || (range.includeMax && value === range.max))
        )
      }
    }
    const rules = () =>
      legend?.field && legend.type === 'category'
        ? (legend.items ?? [])
        : legend?.field && legend.type === 'interval'
          ? (legend.ranges ?? [])
          : []
    const matchesLegend = (feature: Feature) =>
      legendFilter === undefined || ruleFor(feature)?.id === legendFilter
    const matchesFilter = (feature: Feature) => !featureFilter || featureFilter(feature)
    const featureStyle = (feature: Feature) => {
      if (!matchesFilter(feature)) return undefined
      const rule = ruleFor(feature)
      if (legendFilter !== undefined && rule?.id !== legendFilter) return undefined
      const color = rule?.color
      if (!color) return vectorStyle
      const line = /LineString$/.test(feature.getGeometry()?.getType() ?? '')
      const key = (line ? 'line:' : 'fill:') + color
      let style = colors.get(key)
      if (!style) {
        style = makeStyle({ ...styleOptions, [line ? 'strokeColor' : 'fillColor']: color })
        colors.set(key, style)
      }
      return style
    }
    const applyVectorStyle = () => {
      if (!(layer instanceof VectorLayer)) return
      vectorStyle = makeStyle(styleOptions)
      colors.clear()
      enumRules.clear()
      if (legend?.type === 'category')
        for (const item of legend.items ?? [])
          for (const value of item.values ?? []) enumRules.set(value, item)
      if (legendFilter !== undefined && !rules().some((rule) => rule.id === legendFilter))
        legendFilter = undefined
      layer.setStyle(
        legend?.field || featureFilter
          ? (feature) => (feature instanceof Feature ? featureStyle(feature) : undefined)
          : vectorStyle
      )
    }
    const validateOptions = (
      options: Readonly<Record<string, import('@joinmap/gis-core').JsonValue>>
    ) => {
      for (const key of Object.keys(options))
        if (key !== 'opacity')
          throw new Error(`Unsupported OL layer option "${key}". Put style at layer.style.`)
      if (
        options.opacity !== undefined &&
        (typeof options.opacity !== 'number' ||
          !Number.isFinite(options.opacity) ||
          options.opacity < 0 ||
          options.opacity > 1)
      )
        throw new Error('opacity must be a number between 0 and 1.')
    }
    if (config.style && !(layer instanceof VectorLayer))
      throw new Error('style requires a vector layer.')
    validateStyle(styleOptions)
    validateLegend(legend)
    if (config.options) {
      validateOptions(config.options)
      if (typeof config.options.opacity === 'number') layer.setOpacity(config.options.opacity)
    }
    applyVectorStyle()
    layer.set('gisLayerId', config.id)
    const handle: MapLayerHandle = {
      getStyle: () =>
        layer instanceof VectorLayer ? Object.freeze({ ...styleOptions }) : undefined,
      supportsLegendFilter: () => layer instanceof VectorLayer && rules().length > 0,
      getLegendFilter: () => legendFilter,
      setLegendFilter: (ruleId) => {
        if (ruleId !== undefined && !rules().some((rule) => rule.id === ruleId))
          throw new Error(`Unknown legend rule "${ruleId}".`)
        legendFilter = ruleId
        layer.changed()
      },
      setVisible: (visible) => layer.setVisible(visible),
      setZIndex: (zIndex) => layer.setZIndex(zIndex),
      update: (patch) => {
        if (patch.style && !(layer instanceof VectorLayer))
          throw new Error('style requires a vector layer.')
        const nextStyle = patch.style === undefined ? styleOptions : { ...defaults, ...patch.style }
        const nextLegend = patch.legend === undefined ? legend : (patch.legend ?? undefined)
        validateStyle(nextStyle)
        validateLegend(nextLegend)
        if (patch.options) validateOptions(patch.options)
        // Prepare every value before committing any engine mutations.
        styleOptions = nextStyle
        legend = nextLegend
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
      getMetadata: () => ({
        olLayerType: layer.constructor.name,
        opacity: layer.getOpacity(),
        zIndex: layer.getZIndex() ?? 0,
      }),
      resolveLegend: (value) =>
        !value.field &&
        value.useLayerStyle &&
        value.type === 'category' &&
        value.items?.length === 1
          ? {
              ...value,
              items: value.items.map((item) => ({
                ...item,
                color: item.symbol === 'line' ? styleOptions.strokeColor : styleOptions.fillColor,
              })),
            }
          : value,
    }
    if (layer instanceof VectorLayer)
      handle.canSelectFeature = (reference) => {
        const feature = findVectorFeature(layer.getSource(), reference)
        return feature
          ? matchesFilter(feature) && matchesLegend(feature)
          : reference.featureKey === undefined
      }
    this.layerByHandle.set(handle, layer)
    this.matchesLegendByHandle.set(handle, matchesLegend)
    if (layer instanceof VectorLayer)
      this.featureFilterByHandle.set(handle, (filter) => {
        featureFilter = filter
        applyVectorStyle()
        layer.changed()
      })
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
  return {
    create: (context: AppContext, config: LayerConfig) =>
      adapter.createVectorHandle(context, config),
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

const DATE_FIELD = /(^|[_-])(date|time|datetime|timestamp|year)([_-]|$)/i
const ISO_DATE =
  /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s]\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i

function timestampValue(value: unknown, field: string): number | undefined {
  if (typeof value === 'string') {
    const input = value.trim()
    if (!ISO_DATE.test(input)) return undefined
    const normalized = input.replaceAll('/', '-').replace(' ', 'T')
    const timestamp = Date.parse(
      /T/.test(normalized) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
        ? `${normalized}Z`
        : normalized
    )
    return Number.isFinite(timestamp) ? timestamp : undefined
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || !DATE_FIELD.test(field))
    return undefined
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
      if (!values) {
        values = new Set()
        fields.set(field, values)
      }
      values.add(timestamp)
    }
  }
  return [...fields]
    .map(([field, values]) =>
      Object.freeze({ field, values: Object.freeze([...values].sort((a, b) => a - b)) })
    )
    .sort(
      (a, b) =>
        Number(DATE_FIELD.test(b.field)) - Number(DATE_FIELD.test(a.field)) ||
        a.field.localeCompare(b.field)
    )
}
