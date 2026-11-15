import { expect, it, vi } from 'vitest'
import { createGISApp, ResourceScopeImpl } from '../src/index.js'
import { createFakeMapPlugin, FakeMapAdapter } from './fake-map.js'
import type { GISRuntimeError, ResourceScope } from '../src/types.js'

it('rejects selection writes after disposal and releases event/selection listeners', async () => {
  const app = createGISApp()
  await app.init({})
  const selected = vi.fn(), event = vi.fn()
  app.interactions.onSelect(selected)
  app.events.on('feature:selected', event)
  app.interactions.select({ feature: { layerId: 'external', id: 'before' } })
  await app.dispose()
  selected.mockClear(); event.mockClear()
  const final = app.context.state.snapshot()
  expect(() => app.interactions.select({ feature: { layerId: 'external', id: 'after' } })).toThrow(expect.objectContaining({ code: 'APP_DISPOSED' }))
  expect(() => app.interactions.clearSelection()).toThrow(expect.objectContaining({ code: 'APP_DISPOSED' }))
  expect(() => app.interactions.registerTool('late', { id: 'late', activate() {} }, new ResourceScopeImpl())).toThrow(expect.objectContaining({ code: 'APP_DISPOSED' }))
  expect(app.interactions.hasTool('late')).toBe(false)
  app.events.emit('feature:selected', { feature: { layerId: 'external' } })
  app.interactions.onSelect(selected)
  app.events.on('feature:selected', event)
  app.events.emit('feature:selected', {})
  expect(selected).not.toHaveBeenCalled()
  expect(event).not.toHaveBeenCalled()
  expect(app.interactions.getSelection()).toBeUndefined()
  expect(app.context.state.snapshot()).toBe(final)
})

it('guards retained map views while preserving internal target cleanup during disposal', async () => {
  const app = createGISApp(), adapter = new FakeMapAdapter()
  app.use(createFakeMapPlugin(adapter))
  app.use({ name: 'cleanup', install(runtime, _, resources) {
    resources.add(() => {
      expect(runtime.map.getView().getZoom()).toBe(5)
      runtime.map.setTarget(undefined)
      expect(() => runtime.map.getView().setZoom(8)).toThrow(expect.objectContaining({ code: 'APP_DISPOSED' }))
    })
  } })
  await app.init({ map: { center: [1, 2], zoom: 3 } })
  const view = app.map.getView()
  view.setZoom(5)
  expect(adapter.view.zoom).toBe(5)
  await app.dispose()
  for (const write of [() => view.setZoom(9), () => view.setCenter([8, 9]), () => view.fit([0, 0, 1, 1]), () => app.map.updateSize()]) {
    expect(write).toThrow(expect.objectContaining({ code: 'APP_DISPOSED' }))
  }
  expect(adapter.view.zoom).toBe(5)
  expect(adapter.view.center).toEqual([1, 2])
})

it.each(['closed', 'throwing'] as const)('rolls back UI, tool, data and state registrations in a %s scope', async kind => {
  const app = createGISApp(), scope = new ResourceScopeImpl(), invalidUI = vi.fn()
  if (kind === 'closed') await scope.dispose()
  const owner: ResourceScope = kind === 'closed' ? scope : { disposed: false, add() { throw new Error('cannot own registration') }, dispose: async () => {} }
  app.use({ name: 'registrations', install(runtime, _, resources) {
    expect(() => runtime.registerUIAdapter({ mount: invalidUI, unmount() {}, dispose() {} }, owner)).toThrow()
    runtime.registerUIAdapter({ mount() {}, unmount() {}, dispose() {} }, resources)
    expect(() => runtime.registerMapAdapter(new FakeMapAdapter(), owner)).toThrow()
    const map = new FakeMapAdapter()
    runtime.registerMapAdapter(map, resources)
    expect(runtime.map.getAdapter()).toBe(map)
    expect(() => runtime.registerTool('test', { id: 'test', activate() {} }, owner)).toThrow()
    expect(runtime.interactions.hasTool('test')).toBe(false)
    runtime.registerTool('test', { id: 'test', activate() {} }, resources)
    expect(() => runtime.registerDataProcessor('test', { process: input => input }, owner)).toThrow()
    runtime.registerDataProcessor('test', { process: input => input }, resources)
    const stop = vi.fn()
    expect(() => runtime.registerStateSlice('test', { snapshot: () => ({}), subscribe: () => stop }, owner)).toThrow()
    if (kind === 'throwing') expect(stop).toHaveBeenCalledOnce()
    runtime.registerStateSlice('test', { snapshot: () => ({}), subscribe: () => () => {} }, resources)
  } })
  try {
    await app.init({})
    await app.mount('#test')
    expect(invalidUI).not.toHaveBeenCalled()
    await app.interactions.activateTool('test')
    expect((await app.data.load({ type: 'inline', data: 1 }, { processor: 'test' })).data).toBe(1)
  } finally { await app.dispose() }
})

it('rolls back a provider registration when its owner rejects cleanup', async () => {
  const app = createGISApp(), changed = vi.fn()
  app.search.subscribe(changed)
  const scope: ResourceScope = { disposed: false, add() { throw new Error('cannot own registration') }, dispose: async () => {} }
  expect(() => app.search.registerProvider({ id: 'test', search: async () => [] }, scope)).toThrow()
  expect(app.search.listProviders()).toEqual([])
  expect(changed).not.toHaveBeenCalled()
  await app.dispose()
})

it('resets map readiness when view subscription setup fails', async () => {
  const app = createGISApp(), adapter = Object.assign(new FakeMapAdapter(), {
    onViewChange() { throw new Error('cannot subscribe') },
  })
  app.use(createFakeMapPlugin(adapter))
  await expect(app.init({})).rejects.toMatchObject({ stage: 'map-create' })
  expect(adapter.destroyed).toBe(true)
  expect(app.map.isReady).toBe(false)
  expect(app.context.state.snapshot().map.ready).toBe(false)
  await app.dispose()
})

it('continues destroying the map after view listener cleanup fails', async () => {
  const app = createGISApp(), adapter = Object.assign(new FakeMapAdapter(), {
    onViewChange() { return () => { throw new Error('cannot unsubscribe') } },
  })
  app.use(createFakeMapPlugin(adapter))
  await app.init({})
  await expect(app.dispose()).rejects.toMatchObject({ code: 'APP_DISPOSE_FAILED' })
  expect(adapter.destroyed).toBe(true)
  expect(app.status).toBe('disposed')
  expect(app.context.state.snapshot().map.ready).toBe(false)
})

it('clears final interaction state and reports cleanup failures before closing events', async () => {
  const onError = vi.fn(), errorEvent = vi.fn(), app = createGISApp({ onError })
  app.events.on('app:error', errorEvent)
  app.use({ name: 'tool', install(runtime, _, scope) {
    runtime.registerTool('bad', { id: 'bad', activate() {}, deactivate() { throw new Error('cleanup failed') } }, scope)
  } })
  await app.init({})
  await app.interactions.activateTool('bad')
  await expect(app.dispose()).rejects.toMatchObject({ code: 'APP_DISPOSE_FAILED' })
  expect(app.context.state.snapshot().interactions).toEqual({ selection: null, activeToolId: null })
  expect(app.interactions.getActiveTool()).toBeUndefined()
  expect(onError).toHaveBeenCalledOnce()
  expect(errorEvent).toHaveBeenCalledOnce()
})

it('uses a tool-specific error code and retains the activation cause', async () => {
  const app = createGISApp(), cause = new Error('cannot activate')
  app.use({ name: 'tool', install(runtime, _, scope) {
    runtime.registerTool('bad', { id: 'bad', activate() { throw cause } }, scope)
  } })
  await app.init({})
  try {
    await expect(app.interactions.activateTool('bad')).rejects.toMatchObject({ code: 'TOOL_ACTIVATION_FAILED', cause })
    expect(app.interactions.getActiveTool()).toBeUndefined()
  } finally { await app.dispose() }
})

it('reports service and observer errors through onError once and isolates failing reporters', async () => {
  const reported: GISRuntimeError[] = [], events: GISRuntimeError[] = []
  const app = createGISApp({ onError(error) { reported.push(error); throw new Error('reporter failed') } })
  app.events.on('app:error', ({ error }) => { events.push(error) })
  app.events.on('app:error', () => { throw new Error('error observer failed') })
  app.search.registerProvider({ id: 'bad', search: async () => { throw new Error('offline') } })
  await app.init({})
  let failure: unknown
  try { await app.search.search({ keyword: 'test' }) } catch (error) { failure = error }
  expect(failure).toMatchObject({ code: 'SEARCH_FAILED' })
  expect(reported).toEqual([failure])
  expect(events).toEqual([failure])
  app.events.on('feature:selected', () => { throw new Error('observer failed') })
  app.interactions.select({ feature: { layerId: 'external' } })
  expect(reported).toHaveLength(2)
  expect(events).toHaveLength(2)
  expect(reported[1]?.stage).toBe('event-listener')
  await app.dispose()
})
