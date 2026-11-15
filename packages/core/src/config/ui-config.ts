import type { UIConfig } from '../types/ui.js'
import { configError, deepFreeze, isPlainObject, validateJsonValue } from './json.js'

export function validateUIShape(ui: unknown): void {
  if (!isPlainObject(ui)) throw configError('ui must be an object.', 'ui')
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
