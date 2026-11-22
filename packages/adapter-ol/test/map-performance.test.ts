import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import MapBrowserEvent from 'ol/MapBrowserEvent.js'
import DragPan from 'ol/interaction/DragPan.js'
import MouseWheelZoom from 'ol/interaction/MouseWheelZoom.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import { createGISApp } from '@joinmap/gis-core'
import { createOLAdapter, useOLMap } from '../src/index.js'

beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
)
afterEach(() => vi.unstubAllGlobals())

it('accepts the first pan and wheel event with focus on another control', async () => {
  const app = createGISApp()
  app.use(createOLAdapter({ tools: false, controls: false }))
  const target = document.createElement('div'),
    input = document.createElement('input')
  target.tabIndex = 0
  document.body.append(target, input)
  await app.init({ map: { center: [0, 0], zoom: 3 } })
  const map = useOLMap(app)
  try {
    map.setTarget(target)
    input.focus()
    expect(document.activeElement).toBe(input)
    const pointer = Object.assign(new MouseEvent('pointerdown', { button: 0 }), {
      pointerId: 1,
      isPrimary: true,
      pointerType: 'mouse',
    }) as PointerEvent
    const event = new MapBrowserEvent('pointerdown', map, pointer, false, undefined, [pointer])
    event.pixel = [0, 0]
    event.coordinate = [0, 0]
    const pan = map
      .getInteractions()
      .getArray()
      .find((item) => item instanceof DragPan)!
    const down = vi.spyOn(pan, 'handleDownEvent')
    pan.handleEvent(event)
    expect(down).toHaveReturnedWith(true)
    const wheel = new WheelEvent('wheel', { deltaY: -120, cancelable: true })
    const wheelEvent = new MapBrowserEvent('wheel', map, wheel)
    wheelEvent.pixel = [0, 0]
    wheelEvent.coordinate = [0, 0]
    const zoom = map
      .getInteractions()
      .getArray()
      .find((item) => item instanceof MouseWheelZoom)!
    expect(zoom.handleEvent(wheelEvent)).toBe(false)
    expect(wheel.defaultPrevented).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 100))
  } finally {
    await app.dispose()
    target.remove()
    input.remove()
  }
})

it('coalesces view changes, reuses temporal data and cancels pending notifications on disposal', async () => {
  const frames = new Map<number, FrameRequestCallback>()
  let id = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key))
  const flush = () => {
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach((callback) => callback(0))
  }
  const app = createGISApp()
  app.use(createOLAdapter({ tools: false, controls: false, interactions: false }))
  const data = (date: string) => ({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { observed_at: date },
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
    ],
  })
  await app.init({
    map: { center: [0, 0], zoom: 2 },
    layers: [
      { id: 'events', type: 'geojson', source: { type: 'inline', data: data('2024-01-01') } },
    ],
  })
  const map = useOLMap(app),
    layer = app.layers.get('events')!
  const source = (map.getLayers().item(0) as VectorLayer<VectorSource>).getSource()!
  const dimensions = layer.getTimeDimensions()
  const properties = vi.spyOn(source.getFeatures()[0]!, 'getProperties')
  const original = app.context.state.snapshot()
  const changed = vi.fn()
  app.context.state.subscribe(changed)
  try {
    for (let i = 1; i <= 20; i++) {
      map.getView().setCenter([i, i])
      map.getView().setZoom(2 + i / 100)
    }
    expect(changed).not.toHaveBeenCalled()
    flush()
    expect(changed).toHaveBeenCalledTimes(1)
    expect(app.context.state.snapshot().map.center).toEqual([20, 20])
    expect(app.context.state.snapshot().layers).toBe(original.layers)
    expect(layer.getTimeDimensions()).toBe(dimensions)
    expect(properties).not.toHaveBeenCalled()
    app.data.get('layer:events')!.update(data('2025-02-01'))
    expect(layer.getTimeDimensions()).not.toBe(dimensions)
    expect(layer.getTimeDimensions()[0]?.values).toEqual([Date.parse('2025-02-01')])
    expect(original.layers[0]?.metadata.time).not.toEqual(
      app.context.state.snapshot().layers[0]?.metadata.time
    )
    map.getView().setCenter([40, 40])
  } finally {
    await app.dispose()
  }
  changed.mockClear()
  flush()
  expect(changed).not.toHaveBeenCalled()
})
