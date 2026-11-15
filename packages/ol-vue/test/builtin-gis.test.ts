import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import Draw from 'ol/interaction/Draw.js'
import Feature from 'ol/Feature.js'
import LineString from 'ol/geom/LineString.js'
import { createGISApp } from '@joinmap/gis-core'
import { createOLAdapter, useOLMap, useOLTools } from '../../adapter-ol/src/index.js'
import { createVueUI } from '../../ui-vue/src/vue-ui.js'
import type { GISUIContext } from '../../ui-vue/src/types.js'

afterEach(() => vi.unstubAllGlobals())
it('provides tools, properties, pointer status and scale with only the two default plugins', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const app = createGISApp()
  let ui!: GISUIContext
  app.use(createOLAdapter({ controls: false, interactions: false }))
  app.use(createVueUI({ extensions: [{ name: 'test-capture', install(context) { ui = context } }] }))
  const target = document.createElement('div'); document.body.append(target)
  try {
    await app.init({ map: { projection: 'EPSG:3857', center: [0, 0], zoom: 3 }, ui: { layout: 'overlay-dashboard' } })
    const map = useOLMap(app)
    const pointerListeners = () => map.getListeners('pointermove')?.length ?? 0
    const originalListeners = pointerListeners()
    await app.mount(target)
    expect(app.interactions.hasTool('measure-distance')).toBe(true)
    expect(pointerListeners()).toBe(originalListeners + 1)
    expect(target.querySelector('.gis-ui-panel-host--properties')).toBeNull()
    expect(target.querySelector('.gis-ui-status-details')!.textContent).toMatch(/1:/)
    const revision = app.context.state.snapshot().revision
    const coordinates = () => target.querySelector('.gis-ui-status-coordinates output')!
    expect(coordinates().textContent).toBe('--')
    map.dispatchEvent({ type: 'pointermove', coordinate: [1113194.9079, 2273030.927], dragging: false } as never)
    await nextTick()
    expect(coordinates().textContent).toBe('10.00000,20.00000')
    expect(coordinates().children).toHaveLength(0)
    map.getViewport()!.dispatchEvent(new Event('pointerleave'))
    await nextTick()
    expect(coordinates().textContent).toBe('10.00000,20.00000')
    map.dispatchEvent({ type: 'pointermove', coordinate: [-1113194.9079, -2273030.927], dragging: false } as never)
    await nextTick()
    expect(coordinates().textContent).toBe('-10.00000,-20.00000')
    expect(app.context.state.snapshot().revision).toBe(revision)
    ui.panels.hide('status'); await nextTick()
    expect(target.querySelector('.gis-ui-status-content')).toBeNull()
    expect(pointerListeners()).toBe(originalListeners)
    ui.panels.show('status'); await nextTick()
    expect(pointerListeners()).toBe(originalListeners + 1)
    expect(coordinates().textContent).toBe('-10.00000,-20.00000')
    target.querySelector<HTMLButtonElement>('button[aria-label="测量距离"]')!.click()
    await flushPromises()
    const draw = map.getInteractions().getArray().find(item => item instanceof Draw) as Draw
    const undo = vi.spyOn(draw, 'removeLastPoint')
    const viewport = target.querySelector<HTMLElement>('.gis-ui-map-viewport')!
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
    expect(undo).toHaveBeenCalledTimes(1)
    draw.dispatchEvent({ type: 'drawend', feature: new Feature(new LineString([[0, 0], [1000, 0]])) } as never)
    expect(useOLTools(app).list()).toHaveLength(1)
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(app.interactions.getActiveTool()).toBeUndefined()
    const result = useOLTools(app).list()[0]!
    useOLTools(app).select(result.id); await nextTick()
    expect(target.querySelector('.gis-ui-panel-host--properties')!.textContent).toContain(result.id)
    target.querySelector<HTMLButtonElement>('button[aria-label="删除选中结果"]')!.click(); await flushPromises()
    expect(useOLTools(app).list()).toHaveLength(0)
    expect(app.interactions.getSelection()).toBeUndefined()
    expect(app.interactions.getActiveTool()).toBeUndefined()
    expect(target.querySelector('.gis-ui-panel-host--properties')).toBeNull()
    useOLTools(app).importResults([{ id: 'clear-me', toolId: 'draw-point', projection: 'EPSG:3857', geometry: { type: 'Point', coordinates: [0, 0] } }])
    target.querySelector<HTMLButtonElement>('button[aria-label="绘制点"]')!.click(); await flushPromises()
    expect(app.interactions.getActiveTool()).toBe('draw-point')
    target.querySelector<HTMLButtonElement>('button[aria-label="清空全部结果"]')!.click(); await flushPromises()
    expect(useOLTools(app).list()).toHaveLength(0)
    expect(app.interactions.getActiveTool()).toBeUndefined()
    await app.unmount()
    expect(pointerListeners()).toBe(originalListeners)
  } finally { await app.dispose(); target.remove() }
})

it('respects tools:false and explicit properties/status configuration without UI integration plugins', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const app = createGISApp()
  app.use(createOLAdapter({ tools: false, controls: false, interactions: false }))
  app.use(createVueUI())
  const target = document.createElement('div'); document.body.append(target)
  try {
    await app.init({ map: { center: [0, 0], zoom: 2 }, ui: { tools: ['zoom-in', 'draw-point'], panels: [{ id: 'properties', visible: false }, { id: 'status', visible: false }] } })
    await app.mount(target)
    expect(app.interactions.hasTool('draw-point')).toBe(false)
    expect(() => useOLTools(app)).toThrow()
    expect(target.querySelector('button[aria-label="放大"]')).not.toBeNull()
    expect(target.querySelector('button[aria-label="缩小"]')).toBeNull()
    expect(target.querySelector('button[aria-label="绘制点"]')).toBeNull()
    expect(target.querySelector('.gis-ui-status-content')).toBeNull()
    app.interactions.select({ feature: { layerId: 'external', id: 'one' } }); await nextTick()
    expect(target.querySelector('.gis-ui-panel-host--properties')).toBeNull()
  } finally { await app.dispose(); target.remove() }
})
