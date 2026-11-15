import { expect, it, vi } from 'vitest'
import { createGISApp, ResourceScopeImpl } from '../src/index.js'

it('routes searches by layer and preserves immutable provider scopes', async () => {
  const app = createGISApp()
  const layerIds = ['a']
  const a = vi.fn(async () => [{ id: 'a', title: 'A', layerId: 'a' }, { id: 'wrong', title: 'B', layerId: 'b' }])
  const b = vi.fn(async () => [])
  const general = vi.fn(async () => [])
  app.search.registerProvider({ id: 'a', layerIds, search: a })
  app.search.registerProvider({ id: 'b', layerIds: ['b'], search: b })
  app.search.registerProvider({ id: 'general', search: general })
  layerIds.push('b')
  try {
    expect(app.search.listProviders()[0]?.layerIds).toEqual(['a'])
    expect(Object.isFrozen(app.search.listProviders()[0]?.layerIds)).toBe(true)
    expect(await app.search.search({ keyword: 'match', layerId: 'a' })).toEqual([{ id: 'a', title: 'A', layerId: 'a' }])
    expect(a).toHaveBeenCalledOnce(); expect(b).not.toHaveBeenCalled()
    expect(general).toHaveBeenCalledWith(expect.objectContaining({ layerId: 'a' }))
    await app.search.search({ keyword: 'match' })
    expect(b).toHaveBeenCalledOnce()
  } finally { await app.dispose() }
})

it('supports headless providers before init, isolated queries, partial failure and scoped removal', async () => {
  const app = createGISApp(), scope = new ResourceScopeImpl(), changed = vi.fn(), errors = vi.fn()
  app.search.subscribe(changed)
  app.events.on('app:error', errors)
  const stop = app.search.registerProvider({ id: 'good', search: async ({ keyword }) => [{ id: keyword, title: keyword }] }, scope)
  app.search.registerProvider({ id: 'bad', search: async () => { throw new Error('offline') } })
  expect(app.context.search).toBe(app.search)
  expect(() => app.search.registerProvider({ id: 'good', search: async () => [] })).toThrow()
  await app.init({})
  const [a, b] = await Promise.all([app.search.search({ keyword: 'a' }), app.search.search({ keyword: 'b' })])
  expect(a[0]?.id).toBe('a'); expect(b[0]?.id).toBe('b')
  expect(errors).toHaveBeenCalled()
  await scope.dispose(); stop(); stop()
  expect(changed).toHaveBeenCalledTimes(3)
  await expect(app.search.search({ keyword: 'a' })).rejects.toMatchObject({ code: 'SEARCH_FAILED' })
  await app.dispose()
  expect(app.search.listProviders()).toEqual([])
  expect(() => app.search.registerProvider({ id: 'late', search: async () => [] })).toThrow()
})

it('cancels only the requested query even when a provider ignores its signal, and cancels all at shutdown', async () => {
  const app = createGISApp(), signals: AbortSignal[] = []
  app.search.registerProvider({ id: 'pending', search: ({ signal }) => { signals.push(signal!); return new Promise(() => {}) } })
  await app.init({})
  const controller = new AbortController()
  const first = app.search.search({ keyword: 'one', signal: controller.signal })
  const firstFailure = expect(first).rejects.toMatchObject({ name: 'AbortError' })
  const second = app.search.search({ keyword: 'two' })
  const secondFailure = expect(second).rejects.toMatchObject({ name: 'AbortError' })
  await Promise.resolve()
  controller.abort()
  await firstFailure
  expect(signals.map(signal => signal.aborted)).toEqual([true, false])
  await app.dispose(); await secondFailure
  expect(signals[1]!.aborted).toBe(true)
})
