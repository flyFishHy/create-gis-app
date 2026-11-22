import { GISRuntimeError } from '../errors.js'
import type { AppStatus } from '../types.js'

export const writableStatuses: readonly AppStatus[] = [
  'initializing',
  'ready',
  'mounted',
  'unmounted',
]

/** Internal cleanup can opt into disposing/error without reopening business writes. */
export function assertRuntimeStatus(
  status: AppStatus,
  action: string,
  stage: string,
  allowed = writableStatuses
): void {
  if (allowed.includes(status)) return
  throw new GISRuntimeError({
    code: status === 'disposed' || status === 'disposing' ? 'APP_DISPOSED' : 'APP_INVALID_STATE',
    message: `Cannot ${action} while the app is ${status}.`,
    stage,
  })
}
