import type { UIConfig } from '../types/ui.js'
import { configError, deepFreeze, isPlainObject, validateJsonValue } from './json.js'

function validateTimePicker(value: unknown) {
  const path = 'ui.timePicker'
  if (!isPlainObject(value)) throw configError('timePicker must be an object.', path)
  const units = ['hour', 'day', 'week', 'month', 'year']
  const { granularities, defaultGranularity, defaultMode, defaultTimeZone, minTime, maxTime, maxRangeDurationMs } = value
  if (granularities !== undefined && (!Array.isArray(granularities) || !granularities.length
    || granularities.some(unit => typeof unit !== 'string' || !units.includes(unit)) || new Set(granularities).size !== granularities.length)) {
    throw configError('granularities must contain unique supported units.', path + '.granularities')
  }
  if (defaultGranularity !== undefined && (typeof defaultGranularity !== 'string' || !units.includes(defaultGranularity))) {
    throw configError('Unknown time granularity.', path + '.defaultGranularity')
  }
  if (defaultMode !== undefined && !['single', 'range', 'custom-range'].includes(String(defaultMode))) {
    throw configError('Unknown time selection mode.', path + '.defaultMode')
  }
  if (defaultTimeZone !== undefined) {
    try {
      if (typeof defaultTimeZone !== 'string' || /^[+-]/.test(defaultTimeZone)) throw new RangeError()
      new Intl.DateTimeFormat('en', { timeZone: defaultTimeZone })
    } catch { throw configError('defaultTimeZone must be an IANA time zone.', path + '.defaultTimeZone') }
  }
  for (const field of ['showGranularitySwitch', 'showModeSwitch', 'showShortcuts', 'confirmable', 'clearable', 'disabled']) {
    if (value[field] !== undefined && typeof value[field] !== 'boolean') throw configError(field + ' must be a boolean.', path + '.' + field)
  }
  for (const key of ['minTime', 'maxTime']) {
    const limit = value[key]
    if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || Math.abs(limit) > 8.64e15)) {
      throw configError(key + ' must be a valid Unix millisecond timestamp.', path + '.' + key)
    }
  }
  if (typeof minTime === 'number' && typeof maxTime === 'number' && minTime >= maxTime) throw configError('maxTime must be after minTime.', path + '.maxTime')
  if (maxRangeDurationMs !== undefined && (typeof maxRangeDurationMs !== 'number' || !Number.isSafeInteger(maxRangeDurationMs) || maxRangeDurationMs <= 0)) {
    throw configError('maxRangeDurationMs must be a positive millisecond duration.', path + '.maxRangeDurationMs')
  }
}

export function validateUIShape(ui: unknown): void {
  if (!isPlainObject(ui)) throw configError('ui must be an object.', 'ui')
  if (ui.timePicker !== undefined) validateTimePicker(ui.timePicker)
  if (ui.tools !== undefined && (!Array.isArray(ui.tools) || ui.tools.some(id => typeof id !== 'string' || !id.trim()) || new Set(ui.tools).size !== ui.tools.length)) throw configError('ui.tools must contain unique non-empty tool IDs.', 'ui.tools')
  for (const field of ['layout']) {
    if (ui[field] !== undefined && (typeof ui[field] !== 'string' || !ui[field].trim())) {
      throw configError(`ui.${field} must be a non-empty string.`, `ui.${field}`)
    }
  }
  const theme = ui.theme
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
  if (ui.locale !== undefined && !['zh', 'en'].includes(String(ui.locale))) throw configError('Unknown locale.', 'ui.locale')
  if (ui.panels !== undefined && !Array.isArray(ui.panels)) {
    throw configError('ui.panels must be an array.', 'ui.panels')
  }
  const panelIds = new Set<string>()
  for (const [index, value] of (ui.panels as unknown[] | undefined ?? []).entries()) {
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

export function normalizeUIConfig(config: UIConfig): Readonly<UIConfig> {
  validateJsonValue(config, 'ui', new WeakSet())
  validateUIShape(config)
  return deepFreeze(JSON.parse(JSON.stringify(config)) as UIConfig)
}
