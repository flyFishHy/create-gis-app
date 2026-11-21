import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Feature from 'ol/Feature.js'
import LineString from 'ol/geom/LineString.js'
import Draw from 'ol/interaction/Draw.js'
import Modify from 'ol/interaction/Modify.js'
import Snap from 'ol/interaction/Snap.js'
import Point from 'ol/geom/Point.js'
import View from 'ol/View.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import TileLayer from 'ol/layer/Tile.js'
import { createGISApp } from '@joinmap/gis-core'
import { createOLAdapter, createOLLayerHandle, useOLMap, useOLTools } from '../src/index.js'

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }))
afterEach(() => vi.unstubAllGlobals())
const collection = { type: 'FeatureCollection', features: [] }

it('hosts a coordinate popup in an OL overlay and keeps it inside the viewport without panning', async () => {
  const app = createGISApp().use(createOLAdapter({ tools: false }))
  await app.init({ map: { center: [0, 0], zoom: 5 } })
  try {
    const map = useOLMap(app)
    const container = map.getOverlayContainerStopEvent()!
    const element = document.createElement('div')
    Object.defineProperties(element, { offsetWidth: { value: 100 }, offsetHeight: { value: 60 } })
    vi.spyOn(map, 'getSize').mockReturnValue([300, 200])
    const pixel = vi.spyOn(map, 'getPixelFromCoordinate').mockReturnValue([290, 190])
    const release = app.map.addPopupOverlay(element, { coordinate: [10, 15] })!
    const overlay = map.getOverlays().item(0)!
    expect(overlay.getPosition()).toEqual([10, 15])
    expect(overlay.getOffset()).toEqual([-98, -70])
    expect(container.contains(element)).toBe(true)
    expect(map.getView().getCenter()).toEqual([0, 0])

    pixel.mockReturnValue([20, 20])
    map.dispatchEvent('postrender')
    expect(overlay.getOffset()).toEqual([-12, 10])
    pixel.mockReturnValue([-2, 20])
    map.dispatchEvent('postrender')
    expect(element.style.visibility).toBe('hidden')
    release(); release()
    expect(map.getOverlays().getLength()).toBe(0)
    expect(container.contains(element)).toBe(false)
  } finally { await app.dispose() }
})

it('collects map hits once and queries a custom tile layer in the same click', async () => {
  const app = createGISApp()
  const identify = vi.fn(async () => [{ id: 'height', properties: { height: 132 } }])
  app.use(createOLAdapter({ tools: false }))
  app.use({ name: 'identify-tile', install(runtime, _options, scope) {
    runtime.registerLayerType('identify-tile', { create(context, config) {
      const handle = createOLLayerHandle(context, new TileLayer(), config)
      handle.identify = identify
      return handle
    } }, scope)
  } })
  await app.init({ map: { center: [0, 0], zoom: 5, projection: 'EPSG:3857' }, layers: [
    { id: 'points', type: 'geojson', source: { type: 'inline', data: { ...collection, features: [
      { type: 'Feature', id: 'station', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'Station' } },
    ] } } },
    { id: 'terrain', type: 'identify-tile', zIndex: 1 },
    { id: 'hidden', type: 'identify-tile', visible: false, zIndex: 2 },
  ] })
  try {
    const map = useOLMap(app)
    const layer = map.getLayers().item(0) as VectorLayer<VectorSource>
    const feature = layer.getSource()!.getFeatures()[0]!
    const geometry = feature.getGeometry() as Point
    const hit = vi.spyOn(map, 'forEachFeatureAtPixel').mockImplementation((_pixel, callback) => {
      callback(feature, layer, geometry)
      callback(feature, layer, geometry)
    })
    const renderer = vi.fn()
    app.interactions.registerFeaturePicker(renderer)
    map.dispatchEvent({ type: 'singleclick', pixel: [12, 20], coordinate: [0, 0] } as never)
    await vi.waitFor(() => expect(renderer).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'choices',
      candidates: [expect.objectContaining({ layerId: 'terrain', id: 'height' }), expect.objectContaining({ layerId: 'points', id: 'station' })],
    })))
    expect(hit).toHaveBeenCalledOnce()
    expect(identify).toHaveBeenCalledOnce()
    expect(identify).toHaveBeenCalledWith(expect.objectContaining({ pixel: [12, 20], coordinate: [0, 0], projection: 'EPSG:3857' }))
  } finally { await app.dispose() }
})

it('renders typed categories and half-open intervals from the same legend rules as the UI', async () => {
  const app = createGISApp()
  app.use(createOLAdapter({ tools: false, controls: false, interactions: false }))
  const data = { type: 'FeatureCollection', features: [0, 100, 200, null, '100'].map((value, id) => ({
    type: 'Feature', id, properties: { value }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
  })) }
  await app.init({ layers: [{ id: 'rules', type: 'geojson', source: { type: 'inline', data },
    style: { strokeColor: '#888888', strokeWidth: 3 }, legend: { type: 'interval', field: 'value', ranges: [
      { id: 'a', min: 0, max: 100, color: '#ff0000' }, { id: 'b', min: 100, max: 200, color: '#00ff00' },
    ] },
  }] })
  try {
    const layer = useOLMap(app).getLayers().item(0) as VectorLayer<VectorSource>
    const features = layer.getSource()!.getFeatures()
    const style = (index: number) => {
      const result = layer.getStyleFunction()!(features[index]!, 1)
      return Array.isArray(result) ? result[0]! : result as import('ol/style/Style.js').default
    }
    const color = (index: number) => style(index).getStroke()!.getColor()
    expect(features.map((_, index) => color(index))).toEqual(['#ff0000', '#00ff00', '#888888', '#888888', '#888888'])
    await app.layers.update('rules', { legend: { type: 'category', field: 'value', items: [
      { id: 'number', values: [100, 200], label: 'Number', color: '#0000ff' }, { id: 'string', value: '100', label: 'String', color: '#ffff00' },
    ] } })
    expect(color(1)).toBe('#0000ff'); expect(color(2)).toBe('#0000ff'); expect(color(4)).toBe('#ffff00')
    expect(app.layers.get('rules')!.getFieldValues('value')).toEqual([0, 100, 200, '100'])
    expect(Object.isFrozen(app.layers.get('rules')!.getFieldValues('value'))).toBe(true)
    await app.layers.update('rules', { style: { fillColor: '#ff00ff', fillOpacity: 0.5, strokeColor: '#111111', strokeWidth: 5, lineDash: 'dashed', lineCap: 'butt' } })
    expect(color(0)).toBe('#111111'); expect(color(1)).toBe('#0000ff')
    expect(style(1).getStroke()!.getLineDash()).toEqual([8, 5])
    expect(style(1).getStroke()!.getLineCap()).toBe('butt')
    expect(style(1).getFill()!.getColor()).toEqual([255, 0, 255, 0.5])
    const before = app.layers.get('rules')!.version
    await expect(app.layers.update('rules', { options: { opacity: 0.2 }, style: { strokeWidth: -1 } })).rejects.toThrow()
    expect(layer.getOpacity()).toBe(1); expect(app.layers.get('rules')!.version).toBe(before)
    expect(app.context.state.snapshot().layers[0]?.style?.strokeWidth).toBe(5)
    await app.layers.update('rules', { legend: null })
    expect(color(1)).toBe('#111111')
    await expect(app.layers.add({ id: 'tiles', type: 'xyz', source: { url: '/tiles/{z}/{x}/{y}.png' },
      legend: { type: 'category', field: 'value', items: [] },
    })).rejects.toThrow()
  } finally { await app.dispose() }
})

it('reads live typed field values independently of visibility and preserves grouped matches after data updates', async () => {
  const app = createGISApp()
  app.use(createOLAdapter({ tools: false, controls: false, interactions: false }))
  const data = (values: (string | number | boolean | null)[]) => ({ type: 'FeatureCollection', features: values.map(value => ({ type: 'Feature', properties: { kind: value }, geometry: { type: 'Point', coordinates: [0, 0] } })) })
  await app.init({ layers: [{ id: 'values', type: 'geojson', source: { type: 'inline', data: data(['urban', 'suburban', 'urban', false, 0, '0', null]) },
    legend: { type: 'category', field: 'kind', items: [{ id: 'cities', label: 'Cities', values: ['urban', 'suburban'], color: '#123456' }] },
  }] })
  try {
    const layer = app.layers.get('values')!
    expect(layer.getFieldValues('kind')).toEqual(['urban', 'suburban', false, 0, '0'])
    app.layers.setVisibility('values', false)
    expect(layer.getFieldValues('kind')).toContain('suburban')
    app.data.get('layer:values')!.update(data(['new', 'suburban']))
    expect(layer.getFieldValues('kind')).toEqual(['new', 'suburban'])
    expect(app.context.state.snapshot().layers[0]?.legend?.items?.[0]?.values).toEqual(['urban', 'suburban'])
    expect(app.context.state.snapshot().layers[0]?.metadata).not.toHaveProperty('fieldValues')
    const vector = useOLMap(app).getLayers().item(0) as VectorLayer<VectorSource>
    const styles = vector.getStyleFunction()!(vector.getSource()!.getFeatures()[1]!, 1)
    const style = Array.isArray(styles) ? styles[0]! : styles as import('ol/style/Style.js').default
    expect(style.getFill()!.getColor()).toBe('#123456')
  } finally { await app.dispose() }
})

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
    instance.setTimeFilter({ field: 'observed_at', start: current, end: current })
    const errors = vi.fn()
    app.events.on('app:error', errors)
    app.data.get('layer:events')!.update({ ...data, features: data.features.map(feature => ({ ...feature, properties: { name: feature.properties.name } })) })
    expect(instance.getTimeFilter()).toBeUndefined()
    expect(app.context.state.snapshot().layers[0]?.metadata.time).toMatchObject({ dimensions: [], filter: null })
    expect(await app.search.search({ keyword: 'event', layerId: 'events' })).toHaveLength(2)
    expect(errors).not.toHaveBeenCalled()
  } finally { await app.dispose() }
})

it('composes legend rules with time filtering and removes a stale rule on legend replacement', async () => {
  const app = createGISApp().use(createOLAdapter({ tools: false, controls: false, interactions: false }))
  const data = { type: 'FeatureCollection', features: [1, 2, 3].map(value => ({ type: 'Feature', id: value,
    properties: { name: `Site ${value}`, population: value, observed_at: `2024-01-0${value}` },
    geometry: { type: 'Point', coordinates: [value, value] },
  })) }
  await app.init({ layers: [{ id: 'sites', type: 'geojson', source: { type: 'inline', data },
    legend: { type: 'interval', field: 'population', ranges: [{ id: 'low', min: 0, max: 2, color: '#111111' }, { id: 'high', min: 2, max: 3, includeMax: true, color: '#333333' }] },
  }] })
  try {
    const layer = app.layers.get('sites')!
    expect(layer.supportsLegendFilter()).toBe(true)
    layer.setLegendFilter('high')
    const vector = useOLMap(app).getLayers().item(0) as VectorLayer<VectorSource>
    const [low, high] = vector.getSource()!.getFeatures()
    expect(vector.getStyleFunction()!(low!, 1)).toBeUndefined()
    expect(vector.getStyleFunction()!(high!, 1)).toBeDefined()
    expect(await app.search.search({ keyword: 'site' })).toHaveLength(2)
    const time = layer.getTimeDimensions()[0]!.values[1]!
    layer.setTimeFilter({ field: 'observed_at', start: time, end: time })
    expect(await app.search.search({ keyword: 'site' })).toMatchObject([{ title: 'Site 2' }])
    await app.layers.update('sites', { legend: null })
    expect(layer.getLegendFilter()).toBeUndefined()
    expect(layer.supportsLegendFilter()).toBe(false)
  } finally { await app.dispose() }
})

it('edits only the selected result, keeps snapping active and commits the new geometry', async () => {
  const app = createGISApp().use(createOLAdapter())
  await app.init({})
  try {
    const tools = useOLTools(app), map = useOLMap(app)
    tools.importResults(['one', 'two'].map((id, index) => ({ id, toolId: 'draw-point', projection: 'EPSG:3857',
      geometry: { type: 'Point', coordinates: [index, index] },
    })))
    tools.select('one')
    await app.interactions.activateTool('modify-result')
    const interactions = map.getInteractions().getArray()
    const modify = interactions.find(interaction => interaction instanceof Modify)!
    expect(interactions.at(-1)).toBeInstanceOf(Snap)
    const source = (map.getLayers().getArray().at(-1) as VectorLayer<VectorSource>).getSource()!
    const one = source.getFeatureById('one')!
    modify.dispatchEvent('modifystart')
    ;(one.getGeometry() as Point).setCoordinates([3, 4])
    modify.dispatchEvent('modifyend')
    expect(tools.get('one')?.geometry.coordinates).toEqual([3, 4])
    expect(tools.get('two')?.geometry.coordinates).toEqual([1, 1])
    await app.interactions.deactivateTool()
    expect(interactions.some(interaction => interaction instanceof Snap || interaction instanceof Modify)).toBe(false)
  } finally { await app.dispose() }
})

it('resolves layer legend styles without Vue and transforms search coordinates to the current projection', async () => {
  const app = createGISApp()
  app.use(createOLAdapter({ controls: false, interactions: false }))
  await app.init({ map: { projection: 'EPSG:3857', center: [0, 0], zoom: 2 }, layers: [{ id: 'styled', type: 'geojson',
    source: { type: 'inline', data: collection }, style: { fillColor: '#ff0000' },
    legend: { type: 'category', useLayerStyle: true, items: [{ id: 'one', label: 'One', symbol: 'fill', color: '#0000ff' }] },
  }] })
  try {
    expect(app.layers.get('styled')?.legend?.items?.[0]?.color).toBe('#ff0000')
    const old = app.context.state.snapshot()
    await app.layers.update('styled', { style: { fillColor: '#00ff00' } })
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
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    expect(app.context.state.snapshot().map).toMatchObject({ ready: true, projection: 'EPSG:3857', center: [100, 200], zoom: 5, rotation: 0.5 })
    expect(app.context.state.snapshot().revision).toBeGreaterThan(original.revision)
    map.setView(new View({ projection: 'EPSG:4326', center: [10, 20], zoom: 4 }))
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    expect(app.context.state.snapshot().map).toMatchObject({ projection: 'EPSG:4326', center: [10, 20], zoom: 4 })
    const layer = map.getLayers().item(0) as VectorLayer<VectorSource>
    app.data.get('layer:vector')!.update({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'one', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { title: 'One' } }] })
    expect(layer.getSource()!.getFeatures()).toHaveLength(1)
    await app.layers.update('vector', { options: { opacity: 0.4 }, style: { fillColor: '#ff0000', strokeColor: '#000000', strokeWidth: 2 } })
    expect(layer.getOpacity()).toBe(0.4)
    expect(app.layers.get('vector')!.style).toMatchObject({ fillColor: '#ff0000' })
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
