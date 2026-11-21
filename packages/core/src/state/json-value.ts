import type { JsonValue } from '../types/common.js'

/** Plain JSON only. Engine objects, functions and cyclic references are excluded. */
export function stateValue(value: unknown, ancestors = new Set<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (!value || typeof value !== 'object' || ancestors.has(value)) return null
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return null
  const next = new Set(ancestors).add(value)
  if (Array.isArray(value)) return value.map(item => stateValue(item, next))
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && typeof item !== 'function').map(([key, item]) => [key, stateValue(item, next)]))
}

export function freezeStateValue<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freezeStateValue); Object.freeze(value) }
  return value
}
