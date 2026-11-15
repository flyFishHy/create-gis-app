import { GISRuntimeError } from './errors.js'
import type { ResourceScope, Unsubscribe } from './types.js'

export function assertResourceScopeActive(scope: ResourceScope): void {
  if (scope.disposed) throw new GISRuntimeError({ code: 'APP_DISPOSED', message: 'Cannot register in a disposed resource scope.', stage: 'resource-registration' })
}

export class ResourceScopeImpl implements ResourceScope {
  private entries: Array<() => void | Promise<void>> = []
  private isDisposed = false
  private disposal?: Promise<void>

  get disposed(): boolean {
    return this.isDisposed
  }

  add(dispose: () => void | Promise<void>): Unsubscribe {
    if (this.isDisposed) {
      throw new GISRuntimeError({
        code: 'APP_DISPOSED',
        message: 'Cannot add a resource to a disposed scope.',
      })
    }

    let active = true
    const entry = async () => {
      if (!active) return
      active = false
      await dispose()
    }
    this.entries.push(entry)

    return () => {
      active = false
      this.entries = this.entries.filter((candidate) => candidate !== entry)
    }
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal

    this.isDisposed = true
    const entries = this.entries.splice(0).reverse()
    this.disposal = (async () => {
      const errors: unknown[] = []
      for (const dispose of entries) {
        try {
          await dispose()
        } catch (error) {
          errors.push(error)
        }
      }

      if (errors.length > 0) {
        throw new GISRuntimeError({
          code: 'APP_DISPOSE_FAILED',
          message: `${errors.length} resource cleanup operation(s) failed.`,
          cleanupErrors: errors,
        })
      }
    })()

    return this.disposal
  }
}
