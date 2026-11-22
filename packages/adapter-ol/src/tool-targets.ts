import type { DataSet, GISApp, JsonValue, LayerConfig, LayerInstance } from '@joinmap/gis-core'
import { GISRuntimeError } from '@joinmap/gis-core'
import type VectorLayer from 'ol/layer/Vector.js'
import type VectorSource from 'ol/source/Vector.js'

const defaults = {
  'draw-point': '绘制点',
  'draw-line': '绘制线',
  'draw-polygon': '绘制面',
  'measure-distance': '距离测量',
  'measure-area': '面积测量',
  'measure-angle': '角度测量',
} as const

export type ToolId = keyof typeof defaults

export interface ToolTarget {
  id: string
  layer: VectorLayer<VectorSource>
  source: VectorSource
  data: DataSet<JsonValue>
}

export function toolTargets(
  app: GISApp,
  getLayer: (id: string) => VectorLayer<VectorSource> | undefined
) {
  const configured = () => ({
    'draw-point': app.config?.tools?.draw?.targets?.point,
    'draw-line': app.config?.tools?.draw?.targets?.line,
    'draw-polygon': app.config?.tools?.draw?.targets?.polygon,
    'measure-distance': app.config?.tools?.measure?.targets?.distance,
    'measure-area': app.config?.tools?.measure?.targets?.area,
    'measure-angle': undefined,
  })
  const created = new Map<string, LayerInstance>()
  const pending = new Map<string, Promise<void>>()
  const idFor = (tool: ToolId) => `ol-tools:${tool}`
  const configFor = (tool: ToolId, firstFeature?: JsonValue): LayerConfig => ({
    id: idFor(tool),
    type: 'geojson',
    title: defaults[tool],
    source: {
      type: 'inline',
      data: {
        type: 'FeatureCollection',
        features: firstFeature === undefined ? [] : [firstFeature],
      },
    },
  })
  const writable = (id: string): ToolTarget | undefined => {
    const layer = getLayer(id)
    const source = layer?.getSource()
    const data = app.data.get<JsonValue>(`layer:${id}`)
    if (layer && source && data?.status === 'ready' && app.layers.get(id)?.status === 'ready')
      return { id, layer, source, data }
  }
  const requireWritable = (tool: ToolId, id: string): ToolTarget => {
    const target = writable(id)
    if (!target) {
      throw new GISRuntimeError({
        code: app.layers.has(id) ? 'CONFIG_INVALID' : 'LAYER_NOT_FOUND',
        message: `Tool "${tool}" requires a writable inline GeoJSON layer "${id}".`,
      })
    }
    return target
  }
  const existing = (tool: ToolId): ToolTarget | undefined => {
    const explicit = configured()[tool]
    if (explicit !== undefined) return requireWritable(tool, explicit)
    const id = idFor(tool)
    if (app.layers.has(id) && app.layers.get(id) === created.get(id))
      return requireWritable(tool, id)
  }

  return {
    isConfigured: (id: string) => Object.values(configured()).includes(id),
    writable,
    existing,
    async resolve(tool: ToolId, firstFeature?: JsonValue) {
      const current = existing(tool)
      if (current) return { target: current, seeded: false }
      const ids = configured()
      const id = idFor(tool)
      const drawing = tool.startsWith('draw-')
      const group = drawing ? 'ol-tools:draw' : 'ol-tools:measure'
      // Group membership is fixed. Restore an individually removed default
      // on its own while leaving the remaining group's data intact.
      const single =
        tool === 'measure-angle' ||
        (created.has(group) && app.layers.get(group) === created.get(group))
      const root = single ? id : group
      let task = pending.get(root)
      let seeded = false
      if (!task) {
        seeded = firstFeature !== undefined
        const children = (Object.keys(defaults) as ToolId[])
          .filter(
            (key) =>
              key !== 'measure-angle' &&
              key.startsWith(drawing ? 'draw-' : 'measure-') &&
              ids[key] === undefined
          )
          .map((key) => configFor(key, key === tool ? firstFeature : undefined))
        const config: LayerConfig = single
          ? configFor(tool, firstFeature)
          : { id: group, type: 'GROUP', title: drawing ? '绘制结果' : '测量结果', children }
        task = (async () => {
          const instance = await app.layers.add(config)
          created.set(config.id, instance)
          for (const child of config.children ?? [])
            created.set(child.id, app.layers.get(child.id)!)
        })().finally(() => pending.delete(root))
        pending.set(root, task)
      }
      await task
      return { target: requireWritable(tool, id), seeded }
    },
  }
}
