import { describe, expect, it, vi } from 'vitest'
import { createGISApp } from '../src/gis-app.js'
import { createFakeLayerDefinition, createFakeMapPlugin } from './fake-map.js'
import type { AppContext, AppStateSnapshot, DeepReadonly } from '../src/types.js'

describe('Context and app snapshots', () => {
  it('has a stable frozen context without App, isolates apps, and retains historical snapshots', async () => {
    const app = createGISApp()
    const other = createGISApp()
    const context = app.context
    expect('app' in context).toBe(false)
    expect('initializeConfig' in context).toBe(false)
    expect('state' in app).toBe(false)
    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.isFrozen(context.state)).toBe(true)
    expect('setStatus' in context.state).toBe(false)
    expect(context.map).toBe(app.map)
    expect(context.layers).toBe(app.layers)
    const initial = context.state.snapshot()
    expect(initial.status).toBe('created')
    expect(initial.map.ready).toBe(false)
    app.use(createFakeMapPlugin(undefined, { test: createFakeLayerDefinition() }))
    await app.init({ map: { center: [1, 2], zoom: 3 } })
    try {
      expect(app.context).toBe(context)
      expect(context.config).toBe(app.config)
      expect(context.state.snapshot().status).toBe('ready')
      expect(other.context.state.snapshot().status).toBe('created')
      expect(initial.status).toBe('created')
      expect(initial.map.ready).toBe(false)
      expect(() => { (context as unknown as { map: unknown }).map = {} }).toThrow()
      await app.layers.add({ id: 'one', type: 'test' })
      const one = context.state.snapshot()
      expect(Object.isFrozen(one.layers)).toBe(true)
      expect(Object.isFrozen(one.layers[0])).toBe(true)
      expect(() => { (one.layers as unknown as unknown[]).push({}) }).toThrow()
      expect(context.state.snapshot()).toBe(one)
      app.map.getView().setZoom(8)
      expect(context.state.snapshot().layers).toBe(one.layers)
      expect(context.state.snapshot().data).toBe(one.data)
      expect(context.state.snapshot().interactions).toBe(one.interactions)
      expect(context.state.snapshot().map.zoom).toBe(8)
      expect(one.map.zoom).toBe(3)
    } finally { await app.dispose(); await other.dispose() }
    expect(context.state.snapshot().status).toBe('disposed')
    expect(context.state.snapshot().layers).toHaveLength(0)
    expect(context.state.snapshot().map.ready).toBe(false)
  })

  it('exposes context-only callbacks, consistent selection invalidation and no domain copies writable by callers', async () => {
    const app = createGISApp()
    let callback: AppContext | undefined
    app.use(createFakeMapPlugin(undefined, { test: createFakeLayerDefinition() }))
    app.use({ name: 'tools', install(a, _, scope) {
      a.registerTool('draw', { id: 'draw', activate(context) { callback = context } }, scope)
    } })
    await app.init({})
    try {
      const seen: DeepReadonly<AppStateSnapshot>[] = []
      const stop = app.context.state.subscribe(snapshot => seen.push(snapshot))
      await app.layers.add({ id: 'one', type: 'test' })
      app.interactions.select({ feature: { layerId: 'one', id: 1, properties: { nested: { title: 'A' } } } })
      const selected = app.context.state.snapshot()
      app.layers.setVisibility('one', false)
      expect(app.interactions.getSelection()).toBeUndefined()
      expect(app.context.state.snapshot().interactions.selection).toBeNull()
      expect(selected.interactions.selection?.id).toBe(1)
      expect(seen.every(snapshot => !snapshot.interactions.selection || snapshot.layers.some(layer => layer.id === snapshot.interactions.selection!.layerId && layer.visible))).toBe(true)
      await app.interactions.activateTool('draw')
      expect(callback).toBe(app.context)
      expect(app.context.state.snapshot().interactions.activeToolId).toBe('draw')
      const dispose = app.data.load({ id: 'data', type: 'inline', data: { huge: [1, 2, 3] } })
      await dispose
      expect(app.context.state.snapshot().data).toEqual([{ id: 'data', status: 'ready', error: null }])
      stop()
    } finally { await app.dispose() }
  })

  it('owns extension registration cleanup and isolates throwing subscribers', async () => {
    const app = createGISApp()
    let value = 1
    let changed = () => {}
    const cleanup = vi.fn()
    app.use({ name: 'slice', install(a, _, scope) {
      a.registerStateSlice('example', { snapshot: () => ({ value }), subscribe(listener) { changed = listener; return cleanup } }, scope)
    } })
    await app.init({})
    const errors = vi.fn()
    app.events.on('app:error', errors)
    const good = vi.fn()
    app.context.state.subscribe(() => { throw new Error('observer') })
    app.context.state.subscribe(good)
    value = 2; changed()
    expect(app.context.state.snapshot().extensions.example).toEqual({ value: 2 })
    expect(good).toHaveBeenCalled()
    expect(errors).toHaveBeenCalled()
    await app.dispose()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(app.context.state.snapshot().extensions).toEqual({})
    const revision = app.context.state.snapshot().revision
    changed()
    expect(app.context.state.snapshot().revision).toBe(revision)
  })
})
