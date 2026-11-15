import { expect, it, vi } from 'vitest'
import { createGISApp } from '../src/gis-app.js'
import { createFakeLayerDefinition, createFakeMapPlugin, FakeMapAdapter } from './fake-map.js'

it('does not adopt an independent replacement with a former child ID', async () => {
  const app = createGISApp()
  app.use(createFakeMapPlugin(undefined, { test: createFakeLayerDefinition() }))
  await app.init({})
  try {
    await app.layers.add({ id: 'group', type: 'GROUP', children: [{ id: 'child', type: 'test' }] })
    await app.layers.remove('child')
    await app.layers.add({ id: 'child', type: 'test' })
    expect(app.layers.get('group')!.getMetadata().childIds).toEqual([])
    app.layers.setVisibility('group', false)
    expect(app.layers.get('child')!.visible).toBe(true)
    await app.layers.remove('group')
    expect(app.layers.has('child')).toBe(true)
  } finally { await app.dispose() }
})

it('validates before commit and isolates observers after commit', async () => {
  const app = createGISApp()
  await app.init({})
  try {
    const data = await app.data.load<number>({ type: 'inline', data: 1 })
    data.validate(value => { if (value < 0) throw new Error('negative') })
    const listener = vi.fn()
    data.subscribe(() => { throw new Error('observer') })
    data.subscribe(listener)
    expect(() => data.update(-1)).toThrow('negative')
    expect(data.data).toBe(1)
    expect(data.status).toBe('ready')
    expect(listener).not.toHaveBeenCalled()
    data.update(2)
    expect(listener).toHaveBeenCalledWith(2)
  } finally { await app.dispose() }
})

it('attempts handle disposal even when adapter removal fails', async () => {
  const app = createGISApp()
  const adapter = new FakeMapAdapter()
  const dispose = vi.fn()
  app.use(createFakeMapPlugin(adapter, { test: createFakeLayerDefinition(() => ({ setVisible() {}, setZIndex() {}, dispose })) }))
  await app.init({})
  await app.layers.add({ id: 'test', type: 'test' })
  vi.spyOn(adapter, 'removeLayer').mockImplementation(() => { throw new Error('remove failed') })
  await expect(app.layers.remove('test')).rejects.toMatchObject({ code: 'APP_DISPOSE_FAILED' })
  expect(dispose).toHaveBeenCalledOnce()
  await app.dispose()
})

it('waits for pending creation cleanup and releases plugins before the map', async () => {
  const app = createGISApp()
  const adapter = new FakeMapAdapter()
  let finish!: () => void
  const disposed = vi.fn()
  const pluginCleanup = vi.fn(() => expect(adapter.destroyed).toBe(false))
  app.use(createFakeMapPlugin(adapter, { test: { create: () => new Promise(resolve => {
    finish = () => resolve({ setVisible() {}, setZIndex() {}, dispose: disposed })
  }) } }))
  app.use({ name: 'extension', install(_, __, resources) { resources.add(pluginCleanup) } })
  await app.init({})
  const adding = app.layers.add({ id: 'pending', type: 'test' })
  const rejected = expect(adding).rejects.toMatchObject({ code: 'APP_DISPOSED' })
  const disposal = app.dispose()
  await Promise.resolve()
  expect(adapter.destroyed).toBe(false)
  finish()
  await Promise.all([rejected, disposal])
  expect(disposed).toHaveBeenCalledOnce()
  expect(pluginCleanup).toHaveBeenCalledOnce()
  expect(adapter.destroyed).toBe(true)
})
