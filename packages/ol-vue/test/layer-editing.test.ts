import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { createGISApp } from '@joinmap/gis-core'
import { createOLAdapter, useOLMap } from '../../adapter-ol/src/index.js'
import { createVueUI } from '../../ui-vue/src/vue-ui.js'
import VectorLayer from 'ol/layer/Vector.js'
import Style from 'ol/style/Style.js'

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }))
afterEach(() => vi.unstubAllGlobals())
const point = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [10, 20] } }] }
const source = { type: 'inline' as const, data: point }
const legend = { type: 'category' as const, useLayerStyle: true, items: [{ id: 'one', label: 'One', color: '#0000ff' }] }
async function setup() {
  const app = createGISApp()
  app.use(createOLAdapter({ tools: false, controls: false, interactions: false })); app.use(createVueUI())
  const target = document.createElement('div'); document.body.append(target)
  await app.init({ map: { center: [0, 0], zoom: 3 }, layers: [
    { id: 'group', title: 'Group', type: 'GROUP', children: [
      { id: 'a', title: 'Layer A', type: 'geojson', zIndex: 100, source, legend, options: { style: { fillColor: '#0000ff', strokeWidth: 2, pointRadius: 6 } } },
      { id: 'b', title: 'Layer B', type: 'geojson', zIndex: -10, source },
    ] }, { id: 'c', title: 'Layer C', type: 'geojson', zIndex: 50, source },
  ] }); await app.mount(target)
  return { app, target, close: async () => { await app.dispose(); target.remove() } }
}
async function click(root: ParentNode, selector: string) { root.querySelector<HTMLButtonElement>(selector)!.click(); await nextTick() }
async function fill(root: ParentNode, name: string, value: string) {
  const input = root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!
  input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
}
async function apply(root: ParentNode) { root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flushPromises() }

it('locates current data and reorders sibling layers and group blocks with actual OL zIndex changes', async () => {
  const { app, target, close } = await setup()
  try {
    const manager = target.querySelector('.gis-ui-layer-manager')!
    expect([...manager.querySelectorAll('.is-root')].map(row => row.id.split('-row-')[1])).toEqual(['group', 'c'])
    await click(manager, 'button[aria-label="图层配置 Group"]')
    expect(manager.querySelector('button[aria-label="定位图层 Layer A"]')).toBeNull()
    await click(manager, 'button[aria-label="定位图层 Group"]')
    expect(app.map.getView().getCenter()?.[0]).toBeCloseTo(1113194.9079, 2)
    expect(app.map.getView().getZoom()).toBe(3)
    const handle = manager.querySelector<HTMLButtonElement>('[id$="-row-group"] .gis-ui-layer-grip')!
    const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    const start = new Event('dragstart', { bubbles: true }); Object.defineProperty(start, 'dataTransfer', { value: transfer })
    handle.dispatchEvent(start)
    const targetRow = manager.querySelector<HTMLElement>('[id$="-row-c"]')!
    targetRow.dispatchEvent(new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: 90 }))
    targetRow.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })); await nextTick()
    expect(transfer.setData).toHaveBeenCalledWith('text/plain', 'group')
    expect(manager.querySelector('.gis-ui-layer-name')!.textContent).toBe('Layer C')
    expect(app.layers.get('c')!.getMetadata().zIndex).toBeGreaterThan(app.layers.get('b')!.getMetadata().zIndex as number)
    expect(app.layers.get('a')!.getMetadata().zIndex).toBeGreaterThan(app.layers.get('b')!.getMetadata().zIndex as number)
    expect(useOLMap(app).getLayers().getArray().find(layer => layer.get('gisLayerId') === 'c')!.getZIndex()).toBe(2)
    await app.layers.update('group', { zIndex: 20 }); await nextTick()
    expect(app.layers.get('b')!.getMetadata().zIndex).toBe(20)
    expect(app.layers.get('a')!.getMetadata().zIndex).toBe(20.5)
    expect(manager.querySelector('.gis-ui-layer-name')!.textContent).toBe('Group')
    const originalHitTest = document.elementFromPoint
    document.elementFromPoint = () => targetRow
    try {
      const pointer = (type: string, coordinate: number) => Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: coordinate, clientY: coordinate }), { pointerId: 7 })
      handle.dispatchEvent(pointer('pointerdown', 0))
      document.dispatchEvent(pointer('pointermove', 90))
      document.dispatchEvent(pointer('pointerup', 90)); await nextTick()
      expect(manager.querySelector('.gis-ui-layer-name')!.textContent).toBe('Layer C')
      expect(manager.querySelector('.is-dragging')).toBeNull()
    } finally { document.elementFromPoint = originalHitTest }
    app.data.get('layer:a')!.update({ type: 'FeatureCollection', features: [] }); await nextTick()
    app.data.get('layer:b')!.update({ type: 'FeatureCollection', features: [] }); await nextTick()
    expect(manager.querySelector<HTMLButtonElement>('button[aria-label="定位图层 Group"]')!.disabled).toBe(true)
    app.data.get('layer:a')!.update(point); await nextTick()
    expect(manager.querySelector<HTMLButtonElement>('button[aria-label="定位图层 Group"]')!.disabled).toBe(false)
  } finally { await close() }
})

it('applies map styles and legend text together, cancels drafts and detects conflicting/deleted instances', async () => {
  const { app, target, close } = await setup()
  try {
    const manager = target.querySelector('.gis-ui-panel-host--legend')!
    expect(target.querySelector('.gis-ui-layer-manager .gis-ui-layer-edit')).toBeNull()
    await click(manager, '.gis-ui-legend-edit')
    await fill(manager, 'fillColor', '#ff000080'); await fill(manager, 'strokeColor', '#113355')
    await fill(manager, 'strokeWidth', '3'); await fill(manager, 'pointRadius', '7')
    await fill(manager, 'legendTitle', 'Edited legend'); await fill(manager, 'itemLabel-0', 'Edited item')
    await apply(manager)
    expect(manager.querySelector('.gis-ui-layer-editor')).toBeNull()
    expect(app.layers.get('a')!.getMetadata().style).toEqual({ fillColor: '#ff000080', strokeColor: '#113355', strokeWidth: 3, pointRadius: 7 })
    const olLayer = useOLMap(app).getLayers().getArray().find(layer => layer.get('gisLayerId') === 'a') as VectorLayer
    expect((olLayer.getStyle() as Style).getFill()!.getColor()).toBe('#ff000080')
    expect((olLayer.getStyle() as Style).getStroke()!.getWidth()).toBe(3)
    expect(app.layers.get('a')!.legend).toMatchObject({ title: 'Edited legend', items: [{ label: 'Edited item', color: '#ff000080' }] })
    const legendPanel = target.querySelector('.gis-ui-panel-host--legend')!
    expect(legendPanel.textContent).toContain('Edited item')
    await click(legendPanel, '.gis-ui-legend-edit')
    await fill(legendPanel, 'fillColor', '#00ff00')
    await click(legendPanel, '.gis-ui-editor-actions button[type="button"]')
    expect((app.layers.get('a')!.getMetadata().style as { fillColor: string }).fillColor).toBe('#ff000080')
    await click(legendPanel, '.gis-ui-legend-edit')
    await app.layers.update('a', { title: 'External title' }); await nextTick()
    expect(legendPanel.querySelector('[role="alert"]')!.textContent).toContain('其他操作')
    expect(legendPanel.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
    await click(legendPanel, '.gis-ui-editor-conflict button')
    expect(legendPanel.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
    await app.layers.remove('a'); await app.layers.add({ id: 'a', title: 'Replacement', type: 'geojson', source, legend }); await nextTick()
    expect(legendPanel.textContent).toContain('图层已移除')
    expect(legendPanel.querySelector('form')).toBeNull()
  } finally { await close() }
})
