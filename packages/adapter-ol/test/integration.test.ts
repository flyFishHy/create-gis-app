import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Feature from 'ol/Feature.js'
import LineString from 'ol/geom/LineString.js'
import Draw from 'ol/interaction/Draw.js'
import View from 'ol/View.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import { createGISApp } from '@joinmap/gis-core'
import { createOLAdapter, useOLMap, useOLTools } from '../src/index.js'

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }))
afterEach(() => vi.unstubAllGlobals())
const collection = { type: 'FeatureCollection', features: [] }

it('locates current GeoJSON data, merges groups, handles points and preserves correct projection after view replacement', async () => {
  const app = createGISApp()
  app.use(createOLAdapter({ tools: false, controls: false, interactions: false }))
  const point = (coordinate: [number, number]) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coordinate } }] })
  try {
    await app.init({ map: { center: [0, 0], zoom: 4 }, layers: [{ id: 'group', type: 'GROUP', children: [
      { id: 'a', type: 'geojson', zIndex: 100, source: { type: 'inline', data: point([10, 20]) } },
      { id: 'b', type: 'geojson', zIndex: -10, source: { type: 'inline', data: point([30, 40]) } },
    ] }] })
    const first = app.layers.getDataLocation('a')!
    expect(first.coordinate?.[0]).toBeCloseTo(1113194.9079, 2)
    app.map.locate(first)
    expect(app.map.getView().getZoom()).toBe(4)
    expect(app.layers.getDataLocation('group')?.extent?.[2]).toBeCloseTo(3339584.7238, 2)
    app.data.get('layer:a')!.update(point([-10, -20]))
    expect(app.layers.getDataLocation('a')?.coordinate?.[0]).toBeCloseTo(-1113194.9079, 2)
    useOLMap(app).setView(new View({ projection: 'EPSG:4326', center: [0, 0], zoom: 2 }))
    expect(app.layers.getDataLocation('a')).toMatchObject({ projection: 'EPSG:4326' })
    expect(app.layers.getDataLocation('a')?.coordinate?.[0]).toBeCloseTo(-10, 5)
    app.layers.setOrder(['a', 'b', 'group'])
    expect(app.layers.get('b')!.getMetadata().zIndex).toBe(1)
    expect(app.layers.get('a')!.getMetadata().zIndex).toBe(0)
    app.data.get('layer:a')!.update(collection); app.data.get('layer:b')!.update(collection)
    expect(app.layers.getDataLocation('group')).toBeUndefined()
  } finally { await app.dispose() }
})

it('searches GeoJSON attributes per layer, refreshes results with data and releases owned providers', async () => {
  const app = createGISApp()
  app.use(createOLAdapter({ tools: false, controls: false, interactions: false }))
  const data = (name: string) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 1,
    properties: { name, count: 42 }, geometry: { type: 'Point', coordinates: [10, 20] } }] })
  try {
    await app.init({ map: { projection: 'EPSG:3857', center: [0, 0], zoom: 2 }, layers: [
      { id: 'a', title: 'Places A', type: 'geojson', source: { type: 'inline', data: data('Alpha') } },
      { id: 'b', title: 'Places B', type: 'geojson', source: { type: 'inline', data: data('Alpha B') } },
    ] })
    const results = await app.search.search({ keyword: 'ALPHA', layerId: 'a' })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ layerId: 'a', title: 'Alpha', subtitle: 'Places A', projection: 'EPSG:3857' })
    app.map.locate(results[0]!)
    expect(app.map.getView().getCenter()?.[0]).toBeCloseTo(1113194.9079, 2)
    expect(await app.search.search({ keyword: '42', layerId: 'a' })).toHaveLength(1)
    await app.data.get('layer:a')!.update(data('Updated'))
    expect(await app.search.search({ keyword: 'Alpha', layerId: 'a' })).toEqual([])
    expect((await app.search.search({ keyword: 'Updated', layerId: 'a' }))[0]?.title).toBe('Updated')
    await app.layers.remove('a')
    expect(app.search.listProviders().map(provider => provider.layerIds)).toEqual([['b']])
    expect(await app.search.search({ keyword: 'Updated', layerId: 'a' })).toEqual([])
  } finally { await app.dispose() }
  expect(app.search.listProviders()).toEqual([])
})

it('derives date/time dimensions from GeoJSON properties and filters rendered and searched features', async () => {
  const app = createGISApp()
  app.use(createOLAdapter({ tools: false, controls: false, interactions: false }))
  const data = { type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'old', properties: { name: 'Old event', observed_at: '2024-01-01T10:30:00Z' }, geometry: { type: 'Point', coordinates: [0, 0] } },
    { type: 'Feature', id: 'new', properties: { name: 'New event', observed_at: '2024-02-01T10:30:00Z' }, geometry: { type: 'Point', coordinates: [1, 1] } },
  ] }
  await app.init({ layers: [{ id: 'events', title: 'Events', type: 'geojson', source: { type: 'inline', data } }] })
  try {
    const instance = app.layers.get('events')!
    const values = instance.getTimeDimensions().find(item => item.field === 'observed_at')?.values
    expect(values).toEqual([Date.parse('2024-01-01T10:30:00Z'), Date.parse('2024-02-01T10:30:00Z')])
    const current = values![1]!
    instance.setTimeFilter({ field: 'observed_at', start: current, end: current })
    const layer = useOLMap(app).getLayers().item(0) as VectorLayer<VectorSource>
    const style = layer.getStyleFunction()!
    const [oldFeature, newFeature] = layer.getSource()!.getFeatures()
    expect(style(oldFeature!, 1)).toBeUndefined()
    expect(style(newFeature!, 1)).toBeDefined()
    expect(await app.search.search({ keyword: 'event', layerId: 'events' })).toMatchObject([{ id: 'events:new' }])
    expect(instance.getMetadata().time).toMatchObject({ filter: { field: 'observed_at', start: current, end: current } })
    instance.setTimeFilter(undefined)
    expect(await app.search.search({ keyword: 'event', layerId: 'events' })).toHaveLength(2)
  } finally { await app.dispose() }
})

it('resolves layer legend styles without Vue and transforms search coordinates to the current projection', async () => {
  const app = createGISApp()
  app.use(createOLAdapter({ controls: false, interactions: false }))
  await app.init({ map: { projection: 'EPSG:3857', center: [0, 0], zoom: 2 }, layers: [{ id: 'styled', type: 'geojson',
    source: { type: 'inline', data: collection }, options: { style: { fillColor: '#ff0000' } },
    legend: { type: 'category', useLayerStyle: true, items: [{ id: 'one', label: 'One', symbol: 'fill', color: '#0000ff' }] },
  }] })
  try {
    expect(app.layers.get('styled')?.legend?.items?.[0]?.color).toBe('#ff0000')
    const old = app.context.state.snapshot()
    await app.layers.update('styled', { options: { style: { fillColor: '#00ff00' } } })
    expect(app.context.state.snapshot().layers[0]?.legend?.items?.[0]?.color).toBe('#00ff00')
    expect(old.layers[0]?.legend?.items?.[0]?.color).toBe('#ff0000')
    await app.layers.update('styled', { legend: { type: 'category', useLayerStyle: true, items: [{ id: 'a', label: 'A', color: '#ff0000' }, { id: 'b', label: 'B', color: '#0000ff' }] } })
    expect(app.layers.get('styled')?.legend?.items?.map(item => item.color)).toEqual(['#ff0000', '#0000ff'])
    app.map.locate({ projection: 'EPSG:4326', coordinate: [10, 20] })
    expect(app.map.getView().getCenter()?.[0]).toBeCloseTo(1113194.9079, 2)
    expect(app.map.getView().getCenter()?.[1]).toBeCloseTo(2273030.927, 2)
  } finally { await app.dispose() }
})

it('unifies map picks, result selection, business selection and removal', async () => {
  const app = createGISApp()
  app.use(createOLAdapter({ controls: false, interactions: false }))
  await app.init({ map: { center: [0, 0], zoom: 2 }, layers: [{ id: 'vector', type: 'geojson', source: { type: 'inline', data: collection } }] })
  try {
    const tools = useOLTools(app), map = useOLMap(app)
    tools.importResults([{ id: 'result', toolId: 'draw-point', projection: 'EPSG:3857', geometry: { type: 'Point', coordinates: [0, 0] } }])
    const sketch = map.getLayers().getArray().find(layer => layer instanceof VectorLayer && !layer.get('gisLayerId')) as VectorLayer<VectorSource>
    vi.spyOn(map, 'forEachFeatureAtPixel').mockImplementation((_pixel, callback) => callback(sketch.getSource()!.getFeatures()[0]!, sketch, null as never))
    map.dispatchEvent({ type: 'singleclick', pixel: [0, 0] } as never)
    expect(tools.selected()).toBe('result')
    expect(app.interactions.getSelection()).toMatchObject({ source: 'ol-tools', id: 'result', properties: { toolId: 'draw-point' } })
    app.layers.setVisibility('vector', false)
    expect(tools.selected()).toBe('result')
    app.interactions.select({ feature: { layerId: 'vector', id: 'business' } })
    expect(tools.selected()).toBeUndefined()
    tools.select('result')
    expect(app.interactions.getSelection()?.id).toBe('result')
    tools.remove('result')
    expect(app.interactions.getSelection()).toBeUndefined()
    expect(tools.selected()).toBeUndefined()
  } finally { await app.dispose() }
})

it('refreshes GeoJSON data, bridges picks, invalidates hidden selections, and disposes OL', async () => {
  const app = createGISApp()
  app.use(createOLAdapter({ controls: false, interactions: false }))
  await app.init({ layers: [{ id: 'vector', type: 'geojson', source: { type: 'inline', data: collection } }] })
  const map = useOLMap(app)
  try {
    const original = app.context.state.snapshot()
    map.getView().setCenter([100, 200])
    map.getView().setZoom(5)
    map.getView().setRotation(0.5)
    expect(app.context.state.snapshot().map).toMatchObject({ ready: true, projection: 'EPSG:3857', center: [100, 200], zoom: 5, rotation: 0.5 })
    expect(app.context.state.snapshot().revision).toBeGreaterThan(original.revision)
    map.setView(new View({ projection: 'EPSG:4326', center: [10, 20], zoom: 4 }))
    expect(app.context.state.snapshot().map).toMatchObject({ projection: 'EPSG:4326', center: [10, 20], zoom: 4 })
    const layer = map.getLayers().item(0) as VectorLayer<VectorSource>
    app.data.get('layer:vector')!.update({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'one', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { title: 'One' } }] })
    expect(layer.getSource()!.getFeatures()).toHaveLength(1)
    await app.layers.update('vector', { options: { opacity: 0.4, style: { fillColor: '#ff0000', strokeColor: '#000000', strokeWidth: 2 } } })
    expect(layer.getOpacity()).toBe(0.4)
    expect(app.layers.get('vector')!.getMetadata().style).toMatchObject({ fillColor: '#ff0000' })
    await expect(app.layers.update('vector', { options: { opacity: 0.9, unknown: true } })).rejects.toThrow()
    expect(layer.getOpacity()).toBe(0.4)
    const previous = app.data.get('layer:vector')!.data
    expect(() => app.data.get('layer:vector')!.update({ type: 'invalid' })).toThrow()
    expect(app.data.get('layer:vector')!.data).toBe(previous)
    expect(layer.getSource()!.getFeatures()).toHaveLength(1)
    vi.spyOn(map, 'forEachFeatureAtPixel').mockImplementation((_pixel, callback) => callback(layer.getSource()!.getFeatures()[0]!, layer, null as never))
    map.dispatchEvent({ type: 'singleclick', pixel: [0, 0] } as never)
    expect(app.interactions.getSelection()).toMatchObject({ layerId: 'vector', id: 'one', properties: { title: 'One' } })
    app.layers.setVisibility('vector', false)
    expect(app.interactions.getSelection()).toBeUndefined()
  } finally { await app.dispose() }
  expect(map.getLayers().getLength()).toBe(0)
})

it('runs real drawing interactions through Core, preserves sketches on sorting, and calculates angles', async () => {
  const app = createGISApp()
  app.use(createOLAdapter({ controls: false, interactions: false }))
  await app.init({ map: { projection: 'EPSG:4326', center: [0, 0], zoom: 2 }, layers: [{ id: 'vector', type: 'geojson', source: { type: 'inline', data: collection } }] })
  const map = useOLMap(app)
  try {
    await app.interactions.activateTool('measure-angle')
    const draw = map.getInteractions().getArray().find(i => i instanceof Draw)!
    draw.dispatchEvent({ type: 'drawend', feature: new Feature(new LineString([[0, -1], [0, 0], [-1, 0]])) } as never)
    expect(useOLTools(app).list()[0]).toMatchObject({ value: 90, unit: '°', projection: 'EPSG:4326' })
    expect(app.context.state.snapshot().extensions['ol-tools']).toMatchObject({ results: [{ value: 90, unit: '°' }] })
    const tools = useOLTools(app)
    const result = tools.list()[0]!
    tools.select(result.id)
    expect(tools.selected()).toBe(result.id)
    tools.updateGeometry(result.id, { type: 'LineString', coordinates: [[1, 0], [0, 0], [1, 1]] })
    expect(tools.get(result.id)!.value).toBeCloseTo(45)
    expect(() => tools.updateGeometry(result.id, { type: 'LineString', coordinates: [[0, 0], [0, 0], [1, 1]] })).toThrow()
    expect(tools.get(result.id)!.value).toBeCloseTo(45)
    const saved = tools.exportResults()
    tools.remove(result.id)
    expect(tools.list()).toHaveLength(0)
    tools.importResults(saved)
    expect(tools.list()).toHaveLength(1)
    expect(() => tools.importResults(saved)).toThrow()
    app.layers.setOrder(['vector'])
    expect(map.getLayers().getLength()).toBe(2)
    await app.interactions.activateTool('draw-point')
    expect(map.getInteractions().getArray()).not.toContain(draw)
    await useOLTools(app).cancel()
    expect(useOLTools(app).list()).toHaveLength(1)
    await useOLTools(app).clear()
    expect(useOLTools(app).list()).toHaveLength(0)
  } finally { await app.dispose() }
})

it('allows retry of a failed GeoJSON URL with the same id', async () => {
  const app = createGISApp()
  app.use(createOLAdapter({ controls: false, interactions: false }))
  await app.init({})
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true, json: async () => collection }))
  const config = { id: 'retry', type: 'geojson', source: { type: 'url', url: '/data.json' } } as const
  try {
    await expect(app.layers.add(config)).rejects.toThrow()
    expect(app.data.get('layer:retry')).toBeUndefined()
    await app.layers.add(config)
    expect(app.layers.has('retry')).toBe(true)
  } finally { await app.dispose() }
})
