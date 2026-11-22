import { expect, it, vi } from 'vitest'
import { createGISApp, type LayerIdentifyHit, type MapFeaturePick } from '../src/index.js'
import { FakeMapAdapter, createFakeLayerDefinition, createFakeMapPlugin } from './fake-map.js'

const local = { id: 'local', layerId: 'points' }
const pick: MapFeaturePick = {
  pixel: [20, 30],
  location: { coordinate: [10, 15], projection: 'EPSG:3857', resolution: 2 },
  layerIds: ['remote', 'points'],
  candidates: [local],
}
const anchor = { coordinate: [10, 15], projection: 'EPSG:3857' }

it('waits for per-layer identify, sorts mixed candidates and leaves selection unchanged until confirmation', async () => {
  const app = createGISApp()
  let respond!: (hits: LayerIdentifyHit[]) => void
  const identify = vi.fn(
    () =>
      new Promise<LayerIdentifyHit[]>((resolve) => {
        respond = resolve
      })
  )
  app.use(
    createFakeMapPlugin(undefined, {
      remote: createFakeLayerDefinition(() => ({
        identify,
        setVisible() {},
        setZIndex() {},
        dispose() {},
      })),
    })
  )
  try {
    await app.init({ layers: [{ id: 'remote', type: 'remote' }] })
    const ui = vi.fn()
    app.interactions.registerFeaturePicker(ui)
    const completion = app.interactions.pickFeatures(pick)
    await Promise.resolve()
    expect(identify).toHaveBeenCalledWith({
      ...pick.location,
      pixel: pick.pixel,
      signal: expect.any(AbortSignal),
    })
    expect(ui).toHaveBeenLastCalledWith({ status: 'loading', pixel: pick.pixel, anchor })
    expect(app.interactions.getSelection()).toBeUndefined()
    respond([{ id: 'remote-hit', properties: { height: 132 } }])
    await completion
    expect(ui).toHaveBeenLastCalledWith({
      status: 'choices',
      pixel: pick.pixel,
      anchor,
      incomplete: false,
      candidates: [{ layerId: 'remote', id: 'remote-hit', properties: { height: 132 } }, local],
    })
    expect(app.interactions.getSelection()).toBeUndefined()
    app.interactions.select({ feature: local })
    expect(ui).toHaveBeenLastCalledWith(undefined)
    expect(app.interactions.getSelection()).toMatchObject(local)
  } finally {
    await app.dispose()
  }
})

it('times out a stalled layer without clearing selection and discards responses to superseded clicks', async () => {
  vi.useFakeTimers()
  const app = createGISApp()
  let respond!: (hits: LayerIdentifyHit[]) => void
  const identify = vi.fn(
    () =>
      new Promise<LayerIdentifyHit[]>((resolve) => {
        respond = resolve
      })
  )
  app.use(
    createFakeMapPlugin(undefined, {
      remote: createFakeLayerDefinition(() => ({
        identify,
        setVisible() {},
        setZIndex() {},
        dispose() {},
      })),
    })
  )
  try {
    await app.init({ layers: [{ id: 'remote', type: 'remote' }] })
    const ui = vi.fn()
    app.interactions.registerFeaturePicker(ui)
    app.interactions.select({ feature: local })
    const stalled = app.interactions.pickFeatures({ ...pick, candidates: [] })
    await vi.advanceTimersByTimeAsync(2000)
    await stalled
    expect(ui).toHaveBeenLastCalledWith({ status: 'failed', pixel: pick.pixel, anchor })
    expect(app.interactions.getSelection()).toMatchObject(local)

    const old = app.interactions.pickFeatures(pick)
    await Promise.resolve()
    await app.interactions.pickFeatures({
      ...pick,
      layerIds: ['points'],
      candidates: [{ ...local, id: 'new' }],
    })
    respond([{ id: 'late' }])
    await old
    expect(ui).toHaveBeenLastCalledWith(undefined)
    expect(app.interactions.getSelection()?.id).toBe('new')
  } finally {
    await app.dispose()
    vi.useRealTimers()
  }
})

it('keeps completed anchored choices through a pan and clears them on zoom', async () => {
  class AnchoredMap extends FakeMapAdapter {
    addPopupOverlay() {
      return () => {}
    }
  }
  const app = createGISApp().use(createFakeMapPlugin(new AnchoredMap()))
  try {
    await app.init({ map: { center: [0, 0], zoom: 4 } })
    const ui = vi.fn()
    app.interactions.registerFeaturePicker(ui)
    await app.interactions.pickFeatures({
      ...pick,
      candidates: [local, { ...local, id: 'overlap' }],
    })
    expect(ui).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'choices', anchor }))
    app.interactions.cancelFeaturePick({ preserveAnchoredChoices: true })
    app.map.getView().setCenter([4, 5])
    expect(ui).toHaveBeenCalledOnce()
    app.map.getView().setZoom(5)
    expect(ui).toHaveBeenLastCalledWith(undefined)
  } finally {
    await app.dispose()
  }
})
