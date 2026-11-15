import Draw from 'ol/interaction/Draw.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import GeoJSON from 'ol/format/GeoJSON.js'
import LineString from 'ol/geom/LineString.js'
import Style from 'ol/style/Style.js'
import Stroke from 'ol/style/Stroke.js'
import Fill from 'ol/style/Fill.js'
import CircleStyle from 'ol/style/Circle.js'
import Feature from 'ol/Feature.js'
import type Geometry from 'ol/geom/Geometry.js'
import { getArea, getLength } from 'ol/sphere.js'
import type OlMap from 'ol/Map.js'
import type { GISApp, ResourceScope } from '@joinmap/gis-core'
import type { JsonValue } from '@joinmap/gis-core'
import { GISRuntimeError } from '@joinmap/gis-core'
import { useOLMap } from './ol-adapter.js'
import { featureReferenceKey, type FeatureReferenceResolver } from './feature-reference.js'

export const olTools = [
  { id: 'measure-area', icon: 'area', type: 'Polygon', title: '测量面积' },
  { id: 'measure-angle', icon: 'angle', type: 'LineString', title: '测量角度' },
  { id: 'measure-distance', icon: 'distance', type: 'LineString', title: '测量距离' },
  { id: 'draw-point', icon: 'pin', type: 'Point', title: '绘制点' },
  { id: 'draw-line', icon: 'edit', type: 'LineString', title: '绘制线' },
  { id: 'draw-polygon', icon: 'polygon', type: 'Polygon', title: '绘制面' },
] as const

export interface OLToolResult {
  readonly id: string
  readonly toolId: string
  readonly projection: string
  readonly geometry: Readonly<Record<string, unknown>>
  readonly value?: number
  readonly unit?: 'm' | 'm²' | '°'
}
export interface OLToolsController {
  list(): readonly OLToolResult[]
  get(id: string): OLToolResult | undefined
  remove(id: string): void
  select(id?: string): void
  selected(): string | undefined
  updateGeometry(id: string, geometry: Readonly<Record<string, unknown>>): void
  exportResults(): readonly OLToolResult[]
  importResults(results: readonly OLToolResult[]): void
  subscribe(listener: () => void): () => void
  clear(): Promise<void>
  cancel(): Promise<void>
  undo(): void
}
const controllers = new WeakMap<GISApp, OLToolsController>()
export function useOLTools(app: GISApp): OLToolsController {
  const controller = controllers.get(app)
  if (!controller) throw new Error('OpenLayers tools are not installed (createOLAdapter({ tools: false })).')
  return controller
}

/** Adapter-owned implementation. No separate plugin installation is required. */
export function installOLTools(app: GISApp, resources: ResourceScope): void {
    const source = new VectorSource()
    const layer = new VectorLayer({ source, zIndex: 10000 })
    let map: OlMap | undefined
    let draw: Draw | undefined
    let sequence = 0
    let results: OLToolResult[] = []
    let selectedId: string | undefined
    let disposed = false
    const listeners = new Set<() => void>()
    const notify = () => { for (const listener of [...listeners]) {
      try { listener() } catch (cause) { app.events.emit('app:error', { error: new GISRuntimeError({ code: 'APP_INVALID_STATE', message: 'Tool result observer failed.', cause }) }) }
    } }
    const assertActive = () => { if (disposed) throw new Error('OL tools have been disposed.') }
    const snapshot = (result: OLToolResult) => structuredClone(result)
    const highlight = new Style({ stroke: new Stroke({ color: '#f59e0b', width: 3 }), fill: new Fill({ color: '#f59e0b33' }), image: new CircleStyle({ radius: 7, fill: new Fill({ color: '#f59e0b' }) }) })
    const format = new GeoJSON()
    const calculate = (toolId: string, geometry: Geometry, projection: string) => {
      const tool = olTools.find(tool => tool.id === toolId)
      if (!tool || geometry.getType() !== tool.type) throw new Error('Geometry does not match its tool.')
      if (!geometry.getExtent().every(Number.isFinite)) throw new Error('Geometry is empty or invalid.')
      if (geometry instanceof LineString && getLength(geometry, { projection }) <= 0) throw new Error('Line must contain distinct points.')
      if (geometry.getType() === 'Polygon' && getArea(geometry, { projection }) <= 0) throw new Error('Polygon must have positive area.')
      const coordinates = format.writeGeometryObject(geometry).coordinates
      const numbers = JSON.stringify(coordinates)
      if (!numbers || numbers.includes('null')) throw new Error('Geometry contains non-finite coordinates.')
      let value: number | undefined
      let unit: OLToolResult['unit']
      if (toolId === 'measure-distance') { value = getLength(geometry, { projection }); unit = 'm' }
      if (toolId === 'measure-area') { value = getArea(geometry, { projection }); unit = 'm²' }
      if (toolId === 'measure-angle' && geometry instanceof LineString) {
        const points = geometry.getCoordinates()
        if (points.length !== 3) throw new Error('An angle requires exactly three points.')
        const [a, b, c] = points as [number[], number[], number[]]
        if (Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) === 0 || Math.hypot(c[0]! - b[0]!, c[1]! - b[1]!) === 0) throw new Error('Angle points must be distinct.')
        const delta = Math.abs(Math.atan2(a[1]! - b[1]!, a[0]! - b[0]!) - Math.atan2(c[1]! - b[1]!, c[0]! - b[0]!)) * 180 / Math.PI
        value = Math.min(delta, 360 - delta); unit = '°'
      }
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new Error('Measurement must be positive and finite.')
      return { value, unit }
    }
    const ensureLayer = () => { map = useOLMap(app); if (!map.getLayers().getArray().includes(layer)) map.addLayer(layer) }
    const stop = () => { if (draw) map?.removeInteraction(draw); draw = undefined }
    const reference = (id: string) => {
      const result = results.find(item => item.id === id)
      return result ? { source: 'ol-tools', layerId: 'ol-tools', id,
        geometryType: source.getFeatureById(id)?.getGeometry()?.getType(),
        properties: { toolId: result.toolId, projection: result.projection,
          ...(result.value === undefined ? {} : { value: result.value, unit: result.unit }) } } : undefined
    }
    const resolve: FeatureReferenceResolver = feature => reference(String(feature.getId()))
    layer.set(featureReferenceKey, resolve)
    resources.add(app.interactions.onSelect(feature => {
      if (selectedId) source.getFeatureById(selectedId)?.setStyle(undefined)
      selectedId = feature?.source === 'ol-tools' && feature.id !== undefined && source.getFeatureById(feature.id)
        ? String(feature.id) : undefined
      if (selectedId) source.getFeatureById(selectedId)?.setStyle(highlight)
      notify()
    }))
    const clearResults = () => {
      source.clear(); results = []
      if (app.interactions.getSelection()?.source === 'ol-tools') app.interactions.clearSelection()
      selectedId = undefined; notify()
    }
    const controller: OLToolsController = {
      list: () => results.map(snapshot),
      get: id => { const result = results.find(result => result.id === id); return result && snapshot(result) },
      selected: () => selectedId,
      select: id => {
        assertActive()
        if (id && !source.getFeatureById(id)) throw new Error(`Result "${id}" not found.`)
        if (id) app.interactions.select({ feature: reference(id)! })
        else if (app.interactions.getSelection()?.source === 'ol-tools') app.interactions.clearSelection()
      },
      remove: id => {
        assertActive()
        const feature = source.getFeatureById(id)
        if (!feature) throw new Error(`Result "${id}" not found.`)
        source.removeFeature(feature); results = results.filter(result => result.id !== id)
        if (selectedId === id) app.interactions.clearSelection()
        notify()
      },
      updateGeometry: (id, data) => {
        assertActive()
        const index = results.findIndex(result => result.id === id)
        if (index < 0) throw new Error(`Result "${id}" not found.`)
        const old = results[index]!
        const geometry = format.readGeometry(data)
        if (!geometry) throw new Error('Geometry is required.')
        const metric = calculate(old.toolId, geometry, old.projection)
        source.getFeatureById(id)!.setGeometry(geometry)
        results[index] = { ...old, ...metric, geometry: format.writeGeometryObject(geometry) as unknown as Record<string, unknown> }
        if (selectedId === id) app.interactions.select({ feature: reference(id)! })
        notify()
      },
      exportResults: () => results.map(snapshot),
      importResults: incoming => {
        assertActive()
        const ids = new Set(results.map(result => result.id))
        const staged = incoming.map(result => {
          if (!result.id?.trim() || ids.has(result.id)) throw new Error('Duplicate or empty result ID.')
          ids.add(result.id)
          ensureLayer()
          if (result.projection !== map!.getView().getProjection().getCode()) throw new Error('Result projection must match map projection.')
          const geometry = format.readGeometry(result.geometry)
          if (!geometry) throw new Error('Geometry is required.')
          return { result: { ...snapshot(result), ...calculate(result.toolId, geometry, result.projection) }, geometry }
        })
        for (const item of staged) {
          const feature = new Feature(item.geometry); feature.setId(item.result.id)
          source.addFeature(feature); results.push(item.result)
        }
        notify()
      },
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
      clear: async () => { assertActive(); await app.interactions.deactivateTool(); clearResults() },
      cancel: () => app.interactions.deactivateTool(),
      undo: () => draw?.removeLastPoint(),
    }
    controllers.set(app, controller)
    app.registerStateSlice('ol-tools', {
      snapshot: () => ({ selectedId: selectedId ?? null, results: controller.list() }) as unknown as JsonValue,
      subscribe: listener => controller.subscribe(listener),
    }, resources)
    for (const tool of olTools) app.registerTool(tool.id, {
      id: tool.id, title: tool.title, undo: () => draw?.removeLastPoint(),
      activate() {
        ensureLayer()
        draw = new Draw({ type: tool.type, ...(tool.id === 'measure-angle' ? { minPoints: 3, maxPoints: 3 } : {}) })
        draw.on('drawend', ({ feature }) => {
          const geometry = feature.getGeometry()!
          const projection = map!.getView().getProjection().getCode()
          let metric: { value?: number; unit?: OLToolResult['unit'] }
          try { metric = calculate(tool.id, geometry, projection) } catch (cause) {
            app.events.emit('app:error', { error: new GISRuntimeError({ code: 'CONFIG_INVALID', message: 'Invalid drawing geometry.', cause }) }); return
          }
          let id: string
          do { id = `sketch-${++sequence}` } while (source.getFeatureById(id))
          feature.setId(id)
          source.addFeature(feature)
          results.push(Object.freeze({ id, toolId: tool.id, projection,
            geometry: format.writeGeometryObject(geometry) as unknown as Record<string, unknown>, ...metric }))
          notify()
        })
        map!.addInteraction(draw)
      }, deactivate: stop,
    }, resources)
    app.registerTool('delete-result', { id: 'delete-result', mode: 'action',
      canActivate: () => !!selectedId, activate: () => { if (selectedId) controller.remove(selectedId) },
    }, resources)
    app.registerTool('clear-results', { id: 'clear-results', mode: 'action', activate: clearResults }, resources)
    resources.add(() => { disposed = true; stop(); map?.removeLayer(layer); source.clear(); source.dispose(); layer.dispose(); results = []; listeners.clear(); controllers.delete(app) })
}
