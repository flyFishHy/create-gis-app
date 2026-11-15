import { GISRuntimeError } from './types.js'
import type { GISAppConfig, JsonValue, LayerLegend, LegendDefinition, UIConfig } from './types.js'

export function normalizeConfig(config: unknown): Readonly<GISAppConfig> {
  if (!isPlainObject(config)) {
    throw configError('Configuration must be a plain JSON object.', '$')
  }

  const seen = new WeakSet<object>()
  validateJsonValue(config, '$', seen)
  validateGISShape(config)

  const clone = JSON.parse(JSON.stringify(config)) as GISAppConfig
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

  if (config.ui !== undefined) {
    if (!isPlainObject(config.ui)) throw configError('ui must be an object.', 'ui')
    for (const field of ['layout']) {
      if (config.ui[field] !== undefined && (typeof config.ui[field] !== 'string' || !config.ui[field].trim())) {
        throw configError(`ui.${field} must be a non-empty string.`, `ui.${field}`)
      }
    }
    const theme = config.ui.theme
    const modes = ['light', 'dark', 'system']
    if (theme !== undefined) {
      if (typeof theme === 'string') {
        if (!modes.includes(theme)) throw configError('Unknown theme mode.', 'ui.theme')
      } else if (!isPlainObject(theme)) throw configError('theme must be a mode or theme object.', 'ui.theme')
      else {
        if (theme.mode !== undefined && !modes.includes(String(theme.mode))) throw configError('Unknown theme mode.', 'ui.theme.mode')
        if (theme.className !== undefined && typeof theme.className !== 'string') throw configError('className must be a string.', 'ui.theme.className')
        if (theme.tokens !== undefined && (!isPlainObject(theme.tokens) || Object.values(theme.tokens).some(value => typeof value !== 'string'))) throw configError('Theme tokens must be strings.', 'ui.theme.tokens')
      }
    }
    if (config.ui.locale !== undefined && !['zh', 'en'].includes(String(config.ui.locale))) throw configError('Unknown locale.', 'ui.locale')
    if (config.ui.panels !== undefined && !Array.isArray(config.ui.panels)) {
      throw configError('ui.panels must be an array.', 'ui.panels')
    }
    const panelIds = new Set<string>()
    for (const [index, value] of (config.ui.panels as unknown[] | undefined ?? []).entries()) {
      const path = `ui.panels[${index}]`
      if (!isPlainObject(value)) throw configError('Panel config must be an object.', path)
      if (typeof value.id !== 'string' || !value.id.trim()) {
        throw configError('Panel id must be a non-empty string.', `${path}.id`)
      }
      if (panelIds.has(value.id)) throw configError(`Panel id "${value.id}" is duplicated.`, `${path}.id`)
      panelIds.add(value.id)
      if (value.visible !== undefined && typeof value.visible !== 'boolean') {
        throw configError('Panel visible must be a boolean.', `${path}.visible`)
      }
      if (value.collapsed !== undefined && typeof value.collapsed !== 'boolean') {
        throw configError('Panel collapsed must be a boolean.', `${path}.collapsed`)
      }
      if (value.position !== undefined && !['left', 'right', 'top', 'bottom', 'floating'].includes(String(value.position))) {
        throw configError('Panel position is invalid.', `${path}.position`)
      }
      if (value.order !== undefined && (typeof value.order !== 'number' || !Number.isFinite(value.order))) {
        throw configError('Panel order must be a finite number.', `${path}.order`)
      }
      for (const dimension of ['width', 'height']) {
        const size = value[dimension]
        if (size !== undefined && !(typeof size === 'string' || (typeof size === 'number' && Number.isFinite(size) && size > 0))) {
          throw configError(`Panel ${dimension} must be a positive number or CSS size string.`, `${path}.${dimension}`)
        }
      }
    }
  }

  const ids = new Set<string>()
  const validateLayers = (layers: unknown[], prefix: string) => {
    layers.forEach((item, index) => {
      const path = `${prefix}[${index}]`
      if (!isPlainObject(item)) throw configError('Layer must be an object.', path)
      if (typeof item.id !== 'string' || !item.id.trim()) throw configError('Layer id must be a non-empty string.', `${path}.id`)
      if (ids.has(item.id)) throw configError(`Layer id "${item.id}" is duplicated.`, `${path}.id`)
      ids.add(item.id)
      if (typeof item.type !== 'string' || !item.type.trim()) throw configError('Layer type must be a non-empty string.', `${path}.type`)
      if (item.legend !== undefined) normalizeLayerLegend(item.legend as LayerLegend, item.id, `${path}.legend`)
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

function validateJsonValue(value: unknown, path: string, seen: WeakSet<object>): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return

  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    throw configError('Configuration numbers must be finite.', path)
  }

  if (typeof value !== 'object') {
    throw configError('Configuration must contain only JSON values.', path)
  }

  if (seen.has(value)) throw configError('Configuration cannot contain cycles.', path)
  seen.add(value)

  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateJsonValue(entry, `${path}[${index}]`, seen))
  } else {
    if (!isPlainObject(value)) throw configError('Configuration objects must be plain objects.', path)
    for (const [key, entry] of Object.entries(value)) {
      validateJsonValue(entry, `${path}.${key}`, seen)
    }
  }

  seen.delete(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

function configError(message: string, path: string): GISRuntimeError {
  return new GISRuntimeError({
    code: 'CONFIG_INVALID',
    message,
    stage: 'config-validation',
    detail: { path },
  })
}

export function normalizeUIConfig(config: UIConfig): Readonly<UIConfig> {
  return normalizeConfig({ ui: config }).ui!
}

export function normalizeLayerLegend(value: LayerLegend, layerId: string, path = 'legend'): LegendDefinition {
  validateJsonValue(value, path, new WeakSet())
  if (!isPlainObject(value) || !['category', 'continuous', 'interval', 'image'].includes(String(value.type))) throw configError('Invalid legend type.', path)
  if (value.id !== undefined && (typeof value.id !== 'string' || !value.id.trim())) throw configError('Legend id must not be empty.', `${path}.id`)
  if (value.title !== undefined && typeof value.title !== 'string') throw configError('Legend title must be a string.', `${path}.title`)
  if (value.useLayerStyle !== undefined && typeof value.useLayerStyle !== 'boolean') throw configError('useLayerStyle must be boolean.', `${path}.useLayerStyle`)
  if (value.imageUrl !== undefined && typeof value.imageUrl !== 'string') throw configError('imageUrl must be a string.', `${path}.imageUrl`)
  const validateItem = (item: unknown, itemPath: string) => {
    if (!isPlainObject(item) || typeof item.id !== 'string' || !item.id.trim() || typeof item.label !== 'string') throw configError('Legend item requires id and label.', itemPath)
    if (item.color !== undefined && typeof item.color !== 'string') throw configError('color must be a string.', itemPath)
    if (item.symbol !== undefined && !['fill', 'line', 'circle', 'square'].includes(String(item.symbol))) throw configError('Invalid legend symbol.', itemPath)
    if (item.visible !== undefined && typeof item.visible !== 'boolean') throw configError('visible must be boolean.', itemPath)
  }
  if (value.items !== undefined) {
    if (!Array.isArray(value.items)) throw configError('items must be an array.', path)
    const ids = new Set<string>()
    value.items.forEach((item, index) => { validateItem(item, `${path}.items[${index}]`); if (ids.has(item.id)) throw configError('Duplicate legend item id.', path); ids.add(item.id) })
  }
  if (value.noData !== undefined) validateItem(value.noData, `${path}.noData`)
  if (value.stops !== undefined && (!Array.isArray(value.stops) || value.stops.some(stop => !isPlainObject(stop) || typeof stop.value !== 'number' || !Number.isFinite(stop.value) || typeof stop.color !== 'string' || (stop.label !== undefined && typeof stop.label !== 'string')))) throw configError('Invalid legend stops.', `${path}.stops`)
  return deepFreeze(JSON.parse(JSON.stringify({ ...value, id: value.id ?? layerId, layerId })) as LegendDefinition)
}
