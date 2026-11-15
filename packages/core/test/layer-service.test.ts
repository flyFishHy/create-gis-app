import { describe, expect, it, vi } from 'vitest'
import { createGISApp } from '../src/gis-app.js'
import type { LayerConfig, MapLayerHandle } from '../src/types.js'
import { createFakeLayerDefinition, createFakeMapPlugin, FakeMapAdapter } from './fake-map.js'

describe('LayerService', () => {
  it('uses one path for configured and dynamically added layers, and releases handles on remove', async () => {
    const adapter = new FakeMapAdapter()
    const handles = new Map<string, MapLayerHandle>()
    const makeLayer = (config: LayerConfig) => {
      const handle: MapLayerHandle = { setVisible: vi.fn(), setZIndex: vi.fn(), update: vi.fn(), dispose: vi.fn() }
      handles.set(config.id, handle)
      return handle
    }
    const app = createGISApp()
    app.use(createFakeMapPlugin(adapter, { raster: createFakeLayerDefinition(makeLayer) }))
    await app.init({ map: { center: [1, 2], zoom: 3 }, layers: [{ id: 'initial', type: 'raster', title: 'Initial' }] })

    const added = await app.layers.add({ id: 'dynamic', type: 'raster', visible: false })
    expect(app.layers.list().map((layer) => layer.id)).toEqual(['initial', 'dynamic'])
    expect(handles.get('dynamic')?.setVisible).toHaveBeenCalledWith(false)
    await app.layers.update('dynamic', { title: 'Updated', visible: true })
    expect(added.title).toBe('Updated')
    expect(added.visible).toBe(true)

    await app.layers.remove('dynamic')
    expect(handles.get('dynamic')?.dispose).toHaveBeenCalledOnce()
    expect(adapter.removed).toContain(handles.get('dynamic'))
    await app.dispose()
  })

  it('rejects duplicate ids and unknown types without corrupting current layers', async () => {
    const app = createGISApp()
    app.use(createFakeMapPlugin(new FakeMapAdapter(), { raster: createFakeLayerDefinition() }))
    await app.init({})
    await app.layers.add({ id: 'one', type: 'raster' })
    await expect(app.layers.add({ id: 'one', type: 'raster' })).rejects.toMatchObject({ code: 'LAYER_DUPLICATE' })
    await expect(app.layers.add({ id: 'unknown', type: 'missing' })).rejects.toMatchObject({ code: 'LAYER_TYPE_NOT_FOUND' })
    expect(app.layers.list().map((layer) => layer.id)).toEqual(['one'])
    await app.dispose()
  })

  it('manages groups recursively and applies visibility to child layers', async () => {
    const handles = new Map<string, MapLayerHandle>()
    const app = createGISApp()
    app.use(createFakeMapPlugin(new FakeMapAdapter(), {
      raster: createFakeLayerDefinition((config) => {
        const handle: MapLayerHandle = { setVisible: vi.fn(), setZIndex: vi.fn(), dispose: vi.fn() }
        handles.set(config.id, handle)
        return handle
      }),
    }))
    await app.init({
      layers: [{
        id: 'group', type: 'GROUP', title: 'Base maps', children: [
          { id: 'a', type: 'raster' },
          { id: 'b', type: 'raster' },
        ],
      }],
    })
    expect(app.layers.get('group')?.getMetadata()).toMatchObject({ childIds: ['a', 'b'] })
    app.layers.setVisibility('group', false)
    expect(handles.get('a')?.setVisible).toHaveBeenCalledWith(false)
    expect(handles.get('b')?.setVisible).toHaveBeenCalledWith(false)
    await app.layers.remove('group')
    expect(app.layers.list()).toHaveLength(0)
    expect(handles.get('a')?.dispose).toHaveBeenCalledOnce()
    expect(handles.get('b')?.dispose).toHaveBeenCalledOnce()
    await app.dispose()
  })
})
