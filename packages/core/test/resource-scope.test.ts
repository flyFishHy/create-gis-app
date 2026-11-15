import { describe, expect, it, vi } from 'vitest'
import { ResourceScopeImpl } from '../src/resource-scope.js'

describe('ResourceScopeImpl', () => {
  it('disposes resources in reverse order and supports unregistering', async () => {
    const scope = new ResourceScopeImpl()
    const order: string[] = []
    scope.add(() => { order.push('first') })
    const unregister = scope.add(() => { order.push('removed') })
    scope.add(() => { order.push('last') })
    unregister()

    await scope.dispose()
    expect(order).toEqual(['last', 'first'])
    expect(scope.disposed).toBe(true)
  })

  it('attempts every cleanup and aggregates errors', async () => {
    const scope = new ResourceScopeImpl()
    const last = vi.fn(() => { throw new Error('last') })
    const first = vi.fn(() => { throw new Error('first') })
    scope.add(first)
    scope.add(last)

    await expect(scope.dispose()).rejects.toMatchObject({ code: 'APP_DISPOSE_FAILED' })
    expect(last).toHaveBeenCalledOnce()
    expect(first).toHaveBeenCalledOnce()
  })

  it('returns the same in-flight disposal and is idempotent', async () => {
    const scope = new ResourceScopeImpl()
    const cleanup = vi.fn()
    scope.add(cleanup)
    const first = scope.dispose()
    const second = scope.dispose()
    expect(second).toBe(first)
    await Promise.all([first, second])
    await scope.dispose()
    expect(cleanup).toHaveBeenCalledOnce()
  })
})
