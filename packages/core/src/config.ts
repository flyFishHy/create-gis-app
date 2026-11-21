import { configError, deepFreeze, isPlainObject, validateJsonValue } from './config/json.js'
import { validateUIShape } from './config/ui-config.js'
export { normalizeUIConfig } from './config/ui-config.js'
import type { GISAppConfig, LayerLegend, LayerStyle, LegendDefinition } from './types.js'

export function normalizeConfig(config: unknown): Readonly<GISAppConfig> {
  if (!isPlainObject(config)) {
    throw configError('Configuration must be a plain JSON object.', '$')
  }

  const seen = new WeakSet<object>()
  validateJsonValue(config, '$', seen)
  const clone = JSON.parse(JSON.stringify(config)) as GISAppConfig
  validateGISShape(clone)
  return deepFreeze(clone)
}

function validateGISShape(config: Record<string, unknown>): void {
  if (config.version !== undefined && typeof config.version !== 'string') {
    throw configError('version must be a string.', 'version')
  }
  if (config.title !== undefined) {
    if (!isPlainObject(config.title) || typeof config.title.content !== 'string' || (config.title.icon !== undefined && typeof config.title.icon !== 'string')) {
      throw configError('title must contain string content and an optional string icon.', 'title')
    }
    if (config.title.subtitle !== undefined && typeof config.title.subtitle !== 'string') {
      throw configError('title.subtitle must be a string.', 'title.subtitle')
    }
  }

  if (config.map !== undefined) {
    if (!isPlainObject(config.map)) throw configError('map must be an object.', 'map')
    const map = config.map
    if (map.projection !== undefined && typeof map.projection !== 'string') {
      throw configError('map.projection must be a string.', 'map.projection')
    }
    if (map.center !== undefined && (!Array.isArray(map.center) || map.center.length !== 2 || map.center.some((part) => typeof part !== 'number'))) {
      throw configError('map.center must contain exactly two numbers.', 'map.center')
    }
    for (const field of ['zoom', 'minZoom', 'maxZoom']) {
      if (map[field] !== undefined && typeof map[field] !== 'number') {
        throw configError(`map.${field} must be a number.`, `map.${field}`)
      }
    }
  }

  if (config.layers !== undefined && !Array.isArray(config.layers)) {
    throw configError('layers must be an array.', 'layers')
  }
  if (config.ui !== undefined) validateUIShape(config.ui)


  const ids = new Set<string>()
  const validateLayers = (layers: unknown[], prefix: string) => {
    layers.forEach((item, index) => {
      const path = `${prefix}[${index}]`
      if (!isPlainObject(item)) throw configError('Layer must be an object.', path)
      if (typeof item.id !== 'string' || !item.id.trim()) throw configError('Layer id must be a non-empty string.', `${path}.id`)
      if (ids.has(item.id)) throw configError(`Layer id "${item.id}" is duplicated.`, `${path}.id`)
      ids.add(item.id)
      if (typeof item.type !== 'string' || !item.type.trim()) throw configError('Layer type must be a non-empty string.', `${path}.type`)
      if (item.legend !== undefined) {
        const original = item.legend as LayerLegend
        const { id, layerId: _layerId, ...legend } = normalizeLayerLegend(original, item.id, `${path}.legend`)
        item.legend = { ...legend, ...(original.id === undefined ? {} : { id }) }
      }
      if (item.style !== undefined) normalizeLayerStyle(item.style as LayerStyle, `${path}.style`)
      if (isPlainObject(item.options) && item.options.style !== undefined) throw configError('Move options.style to layer.style.', `${path}.options.style`)
      if (item.children !== undefined) {
        if (item.type !== 'GROUP' || !Array.isArray(item.children)) {
          throw configError('children is supported only as a GROUP layer array.', `${path}.children`)
        }
        validateLayers(item.children, `${path}.children`)
      }
      if (item.type === 'GROUP' && (!Array.isArray(item.children) || item.children.length === 0)) {
        throw configError('GROUP layer must contain at least one child.', `${path}.children`)
      }
    })
  }
  if (Array.isArray(config.layers)) validateLayers(config.layers, 'layers')

  if (config.data !== undefined) {
    if (!isPlainObject(config.data)) throw configError('data must be an object keyed by data source id.', 'data')
    for (const [id, source] of Object.entries(config.data)) {
      const path = `data.${id}`
      if (!isPlainObject(source)) throw configError('Data source must be an object.', path)
      if (source.type !== 'url' && source.type !== 'inline') {
        throw configError('Data source type must be "url" or "inline".', `${path}.type`)
      }
      if (source.type === 'url' && (typeof source.url !== 'string' || !source.url.trim())) {
        throw configError('URL data source requires a non-empty url.', `${path}.url`)
      }
      if (source.type === 'inline' && source.data === undefined) {
        throw configError('Inline data source requires data.', `${path}.data`)
      }
      if (source.format !== undefined && source.format !== 'json' && source.format !== 'text') {
        throw configError('Data source format must be "json" or "text".', `${path}.format`)
      }
    }
  }
}

export function normalizeLayerLegend(value: LayerLegend, layerId: string, path = 'legend'): LegendDefinition {
  validateJsonValue(value, path, new WeakSet())
  if (!isPlainObject(value) || !['category', 'continuous', 'interval', 'image'].includes(String(value.type))) throw configError('Invalid legend type.', path)
  if (value.id !== undefined && (typeof value.id !== 'string' || !value.id.trim())) throw configError('Legend id must not be empty.', `${path}.id`)
  if (value.title !== undefined && typeof value.title !== 'string') throw configError('Legend title must be a string.', `${path}.title`)
  if (value.field !== undefined && (typeof value.field !== 'string' || !value.field.trim())) throw configError('Legend field must not be empty.', `${path}.field`)
  if (value.useLayerStyle !== undefined && typeof value.useLayerStyle !== 'boolean') throw configError('useLayerStyle must be boolean.', `${path}.useLayerStyle`)
  if (value.imageUrl !== undefined && typeof value.imageUrl !== 'string') throw configError('imageUrl must be a string.', `${path}.imageUrl`)
  const validateItem = (item: unknown, itemPath: string) => {
    if (!isPlainObject(item) || typeof item.id !== 'string' || !item.id.trim() || typeof item.label !== 'string') throw configError('Legend item requires id and label.', itemPath)
    if (item.color !== undefined && typeof item.color !== 'string') throw configError('color must be a string.', itemPath)
    if (item.symbol !== undefined && !['fill', 'line', 'circle', 'square'].includes(String(item.symbol))) throw configError('Invalid legend symbol.', itemPath)
    if (item.visible !== undefined && typeof item.visible !== 'boolean') throw configError('visible must be boolean.', itemPath)
    if (item.value !== undefined && !['string', 'number', 'boolean'].includes(typeof item.value)) throw configError('Category value must be scalar.', itemPath)
    if (item.value !== undefined && item.values !== undefined) throw configError('Use values or legacy value, not both.', itemPath)
    if (item.values !== undefined && (!Array.isArray(item.values) || !item.values.length || item.values.some(value => !['string', 'number', 'boolean'].includes(typeof value)))) throw configError('Category values must be a non-empty scalar array.', itemPath)
    if (Array.isArray(item.values) && new Set(item.values.map(value => JSON.stringify(value))).size !== item.values.length) throw configError('Duplicate category value.', itemPath)
  }
  if (value.items !== undefined) {
    if (!Array.isArray(value.items)) throw configError('items must be an array.', path)
    const ids = new Set<string>()
    value.items.forEach((item, index) => { validateItem(item, `${path}.items[${index}]`); if (ids.has(item.id)) throw configError('Duplicate legend item id.', path); ids.add(item.id) })
  }
  if (value.noData !== undefined) validateItem(value.noData, `${path}.noData`)
  if (value.field && value.type === 'category') {
    const seen = new Set<string>()
    for (const item of value.items ?? []) {
      const values = item.values ?? (item.value === undefined ? [] : [item.value])
      if (!values.length) throw configError('Bound categories require non-empty matching values.', `${path}.items`)
      for (const value of values) {
        const key = JSON.stringify(value)
        if (seen.has(key)) throw configError('Duplicate category value.', `${path}.items`)
        seen.add(key)
      }
    }
  }
  if (value.ranges !== undefined) {
    if (value.type !== 'interval' || !value.field || !Array.isArray(value.ranges)) throw configError('Ranges require interval type and field.', `${path}.ranges`)
    const ids = new Set<string>()
    for (const range of value.ranges) {
      if (!isPlainObject(range) || typeof range.id !== 'string' || !range.id.trim() || ids.has(range.id)
        || typeof range.min !== 'number' || !Number.isFinite(range.min) || typeof range.max !== 'number' || !Number.isFinite(range.max) || range.min >= range.max
        || typeof range.color !== 'string' || !range.color.trim() || (range.label !== undefined && typeof range.label !== 'string')
        || (range.includeMax !== undefined && typeof range.includeMax !== 'boolean')) throw configError('Invalid interval range.', `${path}.ranges`)
      ids.add(range.id)
    }
    const sorted = [...value.ranges].sort((a, b) => a.min - b.min)
    if (sorted.some((range, index) => index > 0 && (range.min < sorted[index - 1]!.max || (range.min === sorted[index - 1]!.max && sorted[index - 1]!.includeMax)))) throw configError('Legend ranges must not overlap.', `${path}.ranges`)
  }
  if (value.stops !== undefined && (!Array.isArray(value.stops) || value.stops.some(stop => !isPlainObject(stop) || typeof stop.value !== 'number' || !Number.isFinite(stop.value) || typeof stop.color !== 'string' || (stop.label !== undefined && typeof stop.label !== 'string')))) throw configError('Invalid legend stops.', `${path}.stops`)
  const normalizeItem = ({ value: legacy, ...item }: import('./types.js').LegendItem) => legacy === undefined ? item : { ...item, values: [legacy] }
  return deepFreeze(JSON.parse(JSON.stringify({ ...value, id: value.id ?? layerId, layerId,
    ...(value.items ? { items: value.items.map(normalizeItem) } : {}),
    ...(value.noData ? { noData: normalizeItem(value.noData) } : {}),
  })) as LegendDefinition)
}

export function normalizeLayerStyle(value: LayerStyle, path = 'style'): LayerStyle {
  validateJsonValue(value, path, new WeakSet())
  if (!isPlainObject(value)) throw configError('Layer style must be an object.', path)
  for (const [key, item] of Object.entries(value)) {
    if (key === 'fillColor' || key === 'strokeColor') {
      if (typeof item !== 'string' || !item.trim()) throw configError('Style color must not be empty.', `${path}.${key}`)
    } else if (key === 'strokeWidth' || key === 'pointRadius') {
      if (typeof item !== 'number' || !Number.isFinite(item) || item <= 0) throw configError('Style sizes must be positive.', `${path}.${key}`)
    } else if (key === 'fillOpacity') {
      if (typeof item !== 'number' || item < 0 || item > 1) throw configError('Fill opacity must be between 0 and 1.', `${path}.${key}`)
    } else if (key === 'lineDash') {
      if (item !== 'solid' && item !== 'dashed' && item !== 'dotted') throw configError('Invalid line dash.', `${path}.${key}`)
    } else if (key === 'lineCap') {
      if (item !== 'round' && item !== 'butt' && item !== 'square') throw configError('Invalid line cap.', `${path}.${key}`)
    } else throw configError('Unknown layer style property.', `${path}.${key}`)
  }
  return deepFreeze(JSON.parse(JSON.stringify(value)) as LayerStyle)
}
