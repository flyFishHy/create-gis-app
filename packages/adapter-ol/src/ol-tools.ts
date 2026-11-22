import Draw from 'ol/interaction/Draw.js'
import Modify from 'ol/interaction/Modify.js'
import Snap from 'ol/interaction/Snap.js'
import Collection from 'ol/Collection.js'
import type VectorLayer from 'ol/layer/Vector.js'
import type VectorSource from 'ol/source/Vector.js'
import GeoJSON from 'ol/format/GeoJSON.js'
import LineString from 'ol/geom/LineString.js'
import { createEditingStyle, type StyleFunction, type default as Style } from 'ol/style/Style.js'
import Feature from 'ol/Feature.js'
import type Geometry from 'ol/geom/Geometry.js'
import { getArea, getLength } from 'ol/sphere.js'
import type OlMap from 'ol/Map.js'
import type { GISApp, ResourceScope } from '@joinmap/gis-core'
import type { JsonValue } from '@joinmap/gis-core'
import { GISRuntimeError } from '@joinmap/gis-core'
import { useOLMap } from './ol-adapter.js'
import { describeFeature } from './feature-reference.js'
import { toolTargets, type ToolId, type ToolTarget } from './tool-targets.js'
import {
  createMeasurementStyles,
  removeMeasurementLabels,
  updateMeasurementLabels,
  watchMeasurementColor,
  type MeasurementLabels,
} from './measurement-display.js'
import type { EventsKey } from 'ol/events.js'
import { unByKey } from 'ol/Observable.js'

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
  importResults(results: readonly OLToolResult[]): Promise<void>
  subscribe(listener: () => void): () => void
  clear(): Promise<void>
  cancel(): Promise<void>
  undo(): void
}
const controllers = new WeakMap<GISApp, OLToolsController>()
export function useOLTools(app: GISApp): OLToolsController {
  const controller = controllers.get(app)
  if (!controller)
    throw new Error('OpenLayers tools are not installed (createOLAdapter({ tools: false })).')
  return controller
}

/** Adapter-owned tools write through the same dataset as ordinary GeoJSON layers. */
export function installOLTools(
  app: GISApp,
  resources: ResourceScope,
  getLayer: (id: string) => VectorLayer<VectorSource> | undefined
): void {
  const targets = toolTargets(app, getLayer)
  const pendingTargets = new Set<ReturnType<typeof targets.resolve>>()
  const attached = new Map<string, ToolTarget & { stop: () => void }>()
  const results = new Map<string, { target: ToolTarget; feature: Feature; result: OLToolResult }>()
  let map: OlMap | undefined
  let draw: Draw | undefined
  let modify: Modify | undefined
  let snap: Snap | undefined
  let activeTarget: ToolTarget | undefined
  let editingId: string | undefined
  let sequence = 0
  let disposed = false
  const labels = new Map<string | undefined, MeasurementLabels>()
  const measurementStyles = createMeasurementStyles()
  let unwatchColor: (() => void) | undefined
  let sketchListener: EventsKey | undefined
  const removeLabel = (id: string | undefined) => {
    const group = labels.get(id)
    if (map && group) removeMeasurementLabels(map, group)
    labels.delete(id)
  }
  const clearLabels = () => {
    for (const id of labels.keys()) removeLabel(id)
  }
  const clearSketch = () => {
    if (sketchListener) unByKey(sketchListener)
    sketchListener = undefined
    removeLabel(undefined)
  }
  const paintLabel = (
    id: string | undefined,
    geometry: Geometry,
    metric: Pick<OLToolResult, 'value' | 'unit'>
  ) => {
    if (!map || metric.value === undefined || !metric.unit) return
    const group = labels.get(id) ?? { overlays: [] }
    updateMeasurementLabels(
      map,
      group,
      geometry,
      metric.value,
      metric.unit,
      id === undefined ? undefined : () => controller.remove(id)
    )
    labels.set(id, group)
  }
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (cause) {
        app.events.emit('app:error', {
          error: new GISRuntimeError({
            code: 'APP_INVALID_STATE',
            message: 'Tool result observer failed.',
            cause,
          }),
        })
      }
    }
  }
  const assertActive = () => {
    if (disposed) throw new Error('OL tools have been disposed.')
  }
  const editingStyles = createEditingStyle() as Record<string, Style[]>
  const format = new GeoJSON()
  const calculate = (toolId: string, geometry: Geometry, projection: string) => {
    const tool = olTools.find((tool) => tool.id === toolId)
    if (!tool || geometry.getType() !== tool.type)
      throw new Error('Geometry does not match its tool.')
    if (!geometry.getExtent().every(Number.isFinite))
      throw new Error('Geometry is empty or invalid.')
    if (geometry instanceof LineString && getLength(geometry, { projection }) <= 0)
      throw new Error('Line must contain distinct points.')
    if (geometry.getType() === 'Polygon' && getArea(geometry, { projection }) <= 0)
      throw new Error('Polygon must have positive area.')
    const coordinates = format.writeGeometryObject(geometry).coordinates
    const numbers = JSON.stringify(coordinates)
    if (!numbers || numbers.includes('null'))
      throw new Error('Geometry contains non-finite coordinates.')
    let value: number | undefined
    let unit: OLToolResult['unit']
    if (toolId === 'measure-distance') {
      value = getLength(geometry, { projection })
      unit = 'm'
    }
    if (toolId === 'measure-area') {
      value = getArea(geometry, { projection })
      unit = 'm²'
    }
    if (toolId === 'measure-angle' && geometry instanceof LineString) {
      const points = geometry.getCoordinates()
      if (points.length !== 3) throw new Error('An angle requires exactly three points.')
      const [a, b, c] = points as [number[], number[], number[]]
      if (
        Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) === 0 ||
        Math.hypot(c[0]! - b[0]!, c[1]! - b[1]!) === 0
      )
        throw new Error('Angle points must be distinct.')
      const delta =
        (Math.abs(
          Math.atan2(a[1]! - b[1]!, a[0]! - b[0]!) - Math.atan2(c[1]! - b[1]!, c[0]! - b[0]!)
        ) *
          180) /
        Math.PI
      value = Math.min(delta, 360 - delta)
      unit = '°'
    }
    if (value !== undefined && (!Number.isFinite(value) || value <= 0))
      throw new Error('Measurement must be positive and finite.')
    return { value, unit }
  }

  const useMap = () => {
    map = useOLMap(app)
    unwatchColor ??= watchMeasurementColor(map, (color) => {
      measurementStyles.setColor(color)
      for (const target of attached.values()) target.layer.changed()
      draw?.getOverlay().changed()
    })
    return map
  }

  const stop = () => {
    clearSketch()
    if (snap) map?.removeInteraction(snap)
    if (modify) map?.removeInteraction(modify)
    if (draw) map?.removeInteraction(draw)
    snap = undefined
    modify = undefined
    draw = undefined
    activeTarget = undefined
    editingId = undefined
  }

  const toolError = (message: string, cause: unknown) =>
    app.events.emit('app:error', {
      error: new GISRuntimeError({ code: 'CONFIG_INVALID', message, cause }),
    })

  const finishTool = (toolId: string) => {
    stop()
    void app.interactions
      .deactivateTool(toolId)
      .catch((cause) => toolError('Completed tool could not be deactivated.', cause))
  }

  const selection = () => {
    const selected = app.interactions.getSelection()
    if (!selected || selected.id === undefined) return
    const entry = results.get(String(selected.id))
    if (entry?.target.id === selected.layerId) return entry
  }

  function sync(target: ToolTarget) {
    const present = new Set<string>()
    const projection = useMap().getView().getProjection().getCode()
    for (const feature of target.source.getFeatures()) {
      const toolId = feature.get('gisToolId') as string | undefined
      const tool = olTools.find((item) => item.id === toolId)
      const id = feature.getId()
      const geometry = feature.getGeometry()
      if (typeof id !== 'string' || !tool || !geometry || geometry.getType() !== tool.type) continue
      const old = results.get(id)
      if (old && old.target.layer !== target.layer) continue
      present.add(id)
      const value = feature.get('value') as OLToolResult['value']
      const unit = feature.get('unit') as OLToolResult['unit']
      const result: OLToolResult = {
        id,
        toolId: tool.id,
        projection,
        geometry: format.writeGeometryObject(geometry) as unknown as Record<string, unknown>,
        ...(value === undefined ? {} : { value, unit }),
      }
      results.set(id, { target, feature, result })
      if (old?.feature !== feature) {
        const style: StyleFunction = (item, resolution) => {
          const base = target.layer.getStyleFunction()?.(item, resolution)
          if (!base) return []
          if (tool.id === 'measure-angle') return measurementStyles.get(item, resolution, tool.id)
          return [
            ...(Array.isArray(base) ? base : [base]),
            ...measurementStyles.get(item, resolution, undefined),
          ]
        }
        feature.setStyle(style)
      }
      if (target.layer.getVisible()) paintLabel(id, geometry, result)
      else removeLabel(id)
    }
    for (const [id, entry] of results)
      if (entry.target.layer === target.layer && !present.has(id)) {
        results.delete(id)
        removeLabel(id)
      }
    notify()
  }

  function attach(target: ToolTarget) {
    if (attached.get(target.id)?.layer === target.layer) return
    const stopData = target.data.subscribe(() => sync(target))
    const visibility = target.layer.on('change:visible', () => sync(target))
    attached.set(target.id, {
      ...target,
      stop: () => {
        stopData()
        unByKey(visibility)
      },
    })
    sync(target)
  }

  resources.add(app.interactions.onSelect(notify))
  resources.add(
    app.layers.subscribe((event) => {
      if (event.id === undefined) return
      if (event.type === 'add' && targets.isConfigured(event.id)) {
        const target = targets.writable(event.id)
        if (target) attach(target)
      }
      if (event.type !== 'remove') return
      const target = attached.get(event.id)
      if (!target) return
      target.stop()
      attached.delete(event.id)
      if (activeTarget?.layer === target.layer) {
        const tool = app.interactions.getActiveTool()
        if (tool) finishTool(tool)
      }
      for (const [id, entry] of results)
        if (entry.target.layer === target.layer) {
          results.delete(id)
          removeLabel(id)
        }
      notify()
    })
  )

  const geoJSONOptions = () => ({
    featureProjection: useMap().getView().getProjection(),
    dataProjection: 'EPSG:4326',
  })

  const write = (target: ToolTarget, features: Feature[], removed: readonly string[] = []) => {
    const current = targets.writable(target.id)
    if (
      current?.layer !== target.layer ||
      current.data !== target.data ||
      current.source !== target.source
    )
      throw new Error(`Target layer "${target.id}" is no longer writable.`)
    const options = geoJSONOptions()
    const data = target.data.data
    const base =
      data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      data.type === 'FeatureCollection' &&
      Array.isArray(data.features)
        ? { ...data, type: 'FeatureCollection', features: data.features }
        : {
            type: 'FeatureCollection',
            features: format.writeFeaturesObject(target.source.getFeatures(), options)
              .features as unknown as JsonValue[],
          }
    const ids = new Set(removed)
    const existing = base.features.filter(
      (feature) =>
        !feature ||
        typeof feature !== 'object' ||
        Array.isArray(feature) ||
        typeof feature.id !== 'string' ||
        !ids.has(feature.id)
    )
    const additions = format.writeFeaturesObject(features, options)
      .features as unknown as JsonValue[]
    target.data.update({ ...base, features: [...existing, ...additions] })
  }

  const resultFeature = (result: Omit<OLToolResult, 'geometry'>, geometry: Geometry) => {
    const feature = new Feature({
      geometry,
      gisToolId: result.toolId,
      projection: result.projection,
    })
    if (result.value !== undefined)
      feature.setProperties({ value: result.value, unit: result.unit })
    feature.setId(result.id)
    return feature
  }

  const getEntry = (id: string) => {
    const entry = results.get(id)
    if (!entry) throw new Error(`Result "${id}" not found.`)
    return entry
  }

  const clearResults = async () => {
    if (editingId) stop()
    if (pendingTargets.size) await Promise.allSettled([...pendingTargets])
    const byTarget = new Map<ToolTarget, string[]>()
    for (const [id, { target }] of results) {
      const ids = byTarget.get(target) ?? []
      ids.push(id)
      byTarget.set(target, ids)
    }
    for (const [target, ids] of byTarget) write(target, [], ids)
  }

  const controller: OLToolsController = {
    list: () => [...results.values()].map(({ result }) => structuredClone(result)),
    get: (id) => {
      const entry = results.get(id)
      return entry && structuredClone(entry.result)
    },
    selected: () => selection()?.result.id,
    select: (id) => {
      assertActive()
      if (id === undefined) {
        if (selection()) app.interactions.clearSelection()
        return
      }
      const { target, feature } = getEntry(id)
      app.interactions.select({ feature: describeFeature(feature, target.id) })
    },
    remove: (id) => {
      assertActive()
      const { target } = getEntry(id)
      if (editingId === id) finishTool('modify-result')
      write(target, [], [id])
    },
    updateGeometry: (id, data) => {
      assertActive()
      const { target, result, feature } = getEntry(id)
      const geometry = format.readGeometry(data)
      if (!geometry) throw new Error('Geometry is required.')
      const metric = calculate(result.toolId, geometry, result.projection)
      const next = feature.clone()
      next.setId(id)
      next.setGeometry(geometry)
      if (metric.value !== undefined) next.setProperties(metric)
      const selected = selection()?.result.id === id
      write(target, [next], [id])
      if (selected) controller.select(id)
    },
    exportResults: () => controller.list(),
    importResults: async (incoming) => {
      assertActive()
      const projection = useMap().getView().getProjection().getCode()
      const ids = new Set<string>()
      const staged = incoming.map((result) => {
        if (!result.id?.trim() || ids.has(result.id) || results.has(result.id))
          throw new Error('Duplicate or empty result ID.')
        ids.add(result.id)
        if (result.projection !== projection)
          throw new Error('Result projection must match map projection.')
        const geometry = format.readGeometry(result.geometry)
        if (!geometry) throw new Error('Geometry is required.')
        const metric = calculate(result.toolId, geometry, projection)
        return resultFeature({ ...result, ...metric }, geometry)
      })
      const grouped = new Map<string, { target: ToolTarget; features: Feature[] }>()
      for (const feature of staged) {
        const { target } = await targets.resolve(feature.get('gisToolId') as ToolId)
        assertActive()
        attach(target)
        const id = String(feature.getId())
        if (results.has(id) || target.source.getFeatureById(id))
          throw new Error(`Feature ID "${id}" already exists.`)
        let batch = grouped.get(target.id)
        if (!batch) {
          batch = { target, features: [] }
          grouped.set(target.id, batch)
        }
        batch.features.push(feature)
      }
      for (const { target, features } of grouped.values()) {
        if (
          features.some(
            (feature) =>
              results.has(String(feature.getId())) || target.source.getFeatureById(feature.getId()!)
          )
        )
          throw new Error('A result ID already exists.')
      }
      const rollback: (() => void)[] = []
      try {
        for (const { target, features } of grouped.values()) {
          const previous = target.data.data
          write(target, features)
          if (previous !== undefined) rollback.push(() => target.data.update(previous))
        }
      } catch (cause) {
        for (const undo of rollback.reverse()) undo()
        throw cause
      }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    clear: async () => {
      assertActive()
      await app.interactions.deactivateTool()
      await clearResults()
    },
    cancel: () => app.interactions.deactivateTool(),
    undo: () => draw?.removeLastPoint(),
  }
  controllers.set(app, controller)
  app.registerStateSlice(
    'ol-tools',
    {
      snapshot: () =>
        ({
          selectedId: controller.selected() ?? null,
          results: controller.list(),
        }) as unknown as JsonValue,
      subscribe: (listener) => controller.subscribe(listener),
    },
    resources
  )

  const startSnap = (except?: Feature) => {
    snap = new Snap({
      features: new Collection(
        [...results.values()]
          .filter(({ target, feature }) => target.layer.getVisible() && feature !== except)
          .map(({ feature }) => feature)
      ),
    })
    useMap().addInteraction(snap)
  }

  for (const tool of olTools)
    app.registerTool(
      tool.id,
      {
        id: tool.id,
        title: tool.title,
        undo: () => draw?.removeLastPoint(),
        activate() {
          const map = useMap()
          const target = targets.existing(tool.id)
          assertActive()
          if (target) attach(target)
          activeTarget = target
          const measured = tool.id.startsWith('measure-')
          const interaction = new Draw({
            type: tool.type,
            stopClick: true,
            style: (feature, resolution) => {
              const styles = measurementStyles.get(feature, resolution, tool.id)
              if (measured) return styles
              return [...(editingStyles[feature.getGeometry()?.getType() ?? ''] ?? []), ...styles]
            },
            ...(tool.id === 'measure-angle' ? { minPoints: 3, maxPoints: 3 } : {}),
          })
          draw = interaction
          if (measured) {
            interaction.on('drawstart', ({ feature }) => {
              clearSketch()
              const geometry = feature.getGeometry()!
              const update = () => {
                const projection = map.getView().getProjection().getCode()
                try {
                  const metric =
                    tool.id === 'measure-distance'
                      ? { value: getLength(geometry, { projection }), unit: 'm' as const }
                      : calculate(tool.id, geometry, projection)
                  paintLabel(undefined, geometry, metric)
                } catch {
                  removeLabel(undefined)
                }
              }
              sketchListener = geometry.on('change', update)
              update()
            })
            interaction.on('drawabort', clearSketch)
          }
          interaction.on('drawend', async ({ feature }) => {
            if (draw !== interaction || !interaction.getActive()) return
            clearSketch()
            let destination = target
            let creating: ReturnType<typeof targets.resolve> | undefined
            try {
              const geometry = feature.getGeometry()!
              const projection = map.getView().getProjection().getCode()
              const metric = calculate(tool.id, geometry, projection)
              destination ??= targets.existing(tool.id)
              let id: string
              do {
                id = `sketch-${++sequence}`
              } while (results.has(id) || destination?.source.getFeatureById(id))
              const completed = resultFeature(
                {
                  id,
                  toolId: tool.id,
                  projection,
                  ...metric,
                },
                geometry.clone()
              )
              let seeded = false
              if (!destination) {
                const firstFeature = format.writeFeatureObject(completed, geoJSONOptions())
                interaction.setActive(false)
                creating = targets.resolve(tool.id, firstFeature as unknown as JsonValue)
                pendingTargets.add(creating)
                const resolved = await creating
                destination = resolved.target
                seeded = resolved.seeded
                assertActive()
              }
              attach(destination)
              if (!seeded) {
                if (destination.source.getFeatureById(id))
                  throw new Error(`Feature ID "${id}" already exists.`)
                write(destination, [completed])
              }
              if (draw === interaction) finishTool(tool.id)
            } catch (cause) {
              if (draw === interaction) interaction.setActive(true)
              toolError(
                destination
                  ? `Could not save the drawing to "${destination.id}".`
                  : 'Could not save the drawing result.',
                cause
              )
            } finally {
              if (creating) pendingTargets.delete(creating)
            }
          })
          map.addInteraction(interaction)
          startSnap()
        },
        deactivate: stop,
      },
      resources
    )
  app.registerTool(
    'modify-result',
    {
      id: 'modify-result',
      canActivate: () => !!selection(),
      activate() {
        const entry = selection()
        if (!entry) return
        const { target, result, feature } = entry
        activeTarget = target
        editingId = result.id
        modify = new Modify({ features: new Collection([feature]) })
        let previous: Geometry | undefined
        modify.on('modifystart', () => {
          previous = feature.getGeometry()?.clone()
        })
        modify.on('modifyend', () => {
          const geometry = feature.getGeometry()
          if (!geometry) return
          try {
            controller.updateGeometry(
              result.id,
              format.writeGeometryObject(geometry) as unknown as Record<string, unknown>
            )
            finishTool('modify-result')
          } catch (cause) {
            feature.setGeometry(previous)
            toolError('Invalid edited geometry.', cause)
          }
        })
        useMap().addInteraction(modify)
        startSnap(feature)
      },
      deactivate: stop,
    },
    resources
  )
  app.registerTool(
    'delete-result',
    {
      id: 'delete-result',
      mode: 'action',
      canActivate: () => !!selection(),
      activate: () => {
        const entry = selection()
        if (entry) controller.remove(entry.result.id)
      },
    },
    resources
  )
  app.registerTool(
    'clear-results',
    { id: 'clear-results', mode: 'action', activate: clearResults },
    resources
  )
  resources.add(() => {
    disposed = true
    stop()
    clearLabels()
    unwatchColor?.()
    for (const target of attached.values()) target.stop()
    attached.clear()
    results.clear()
    listeners.clear()
    controllers.delete(app)
  })
}
