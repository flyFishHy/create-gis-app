import { GISRuntimeError } from '../errors.js';
import type { JsonValue } from '../types/common.js';

export function validateJsonValue(
  value: unknown,
  path: string,
  seen: WeakSet<object>
): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }

  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      return;
    }
    throw configError('Configuration numbers must be finite.', path);
  }

  if (typeof value !== 'object') {
    throw configError('Configuration must contain only JSON values.', path);
  }

  if (seen.has(value)) {
    throw configError('Configuration cannot contain cycles.', path);
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateJsonValue(entry, `${path}[${index}]`, seen));
  } else {
    if (!isPlainObject(value)) {
      throw configError('Configuration objects must be plain objects.', path);
    }
    for (const [key, entry] of Object.entries(value)) {
      validateJsonValue(entry, `${path}.${key}`, seen);
    }
  }

  seen.delete(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function configError(message: string, path: string): GISRuntimeError {
  return new GISRuntimeError({
    code: 'CONFIG_INVALID',
    message,
    stage: 'config-validation',
    detail: { path },
  });
}
