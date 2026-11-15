import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { createGISApp } from '@joinmap/gis-core'
import { createOLAdapter, useOLMap } from '../../adapter-ol/src/index.js'
import { createVueUI } from '../../ui-vue/src/vue-ui.js'

afterEach(() => vi.unstubAllGlobals())
it('expands layer settings and updates actual OL opacity, including a mixed group', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const app = createGISApp()
  app.use(createOLAdapter({ controls: false, interactions: false })); app.use(createVueUI())
  const target = document.createElement('div'); document.body.append(target)
  try {
    await app.init({ layers: [{ id: 'group', title: 'Group', type: 'GROUP', children: [
      { id: 'a', title: 'Layer A', type: 'geojson', options: { opacity: 0.25 }, source: { type: 'inline', data: { type: 'FeatureCollection', features: [] } } },
      { id: 'b', title: 'Layer B', type: 'geojson', options: { opacity: 0.75 }, source: { type: 'inline', data: { type: 'FeatureCollection', features: [] } } },
      { id: 'nested', title: 'Nested', type: 'GROUP', children: [{ id: 'c', title: 'Nested child', type: 'geojson', source: { type: 'inline', data: { type: 'FeatureCollection', features: [] } } }] },
    ] }] }); await app.mount(target)
    expect(target.querySelector('button[aria-label="图层配置 Layer A"]')).toBeNull()
    const button = target.querySelector<HTMLButtonElement>('button[aria-label="图层配置 Group"]')!
    button.click(); await nextTick()
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const row = button.closest('.gis-ui-layer-row')!
    expect(row.querySelector('.gis-ui-layer-state')).toBeNull()
    expect(row.querySelector('.gis-ui-layer-metadata')).toBeNull()
    expect(row.querySelector('button[aria-label*="移除图层"]')).toBeNull()
    const settings = row.querySelector('.gis-ui-layer-settings')!
    expect(settings.children).toHaveLength(2)
    expect(row.querySelector('.gis-ui-layer-opacity')!.children).toHaveLength(3)
    expect(row.querySelector('.gis-ui-layer-opacity')!.textContent).not.toContain('不透明度')
    expect(row.querySelector('.gis-ui-layer-edit')).toBeNull()
    const child = row.querySelector('button[aria-label="切换图层显隐 Layer A"]')!.closest('.gis-ui-layer-child')!
    expect(settings.contains(child)).toBe(true)
    expect(child.querySelectorAll('button')).toHaveLength(1)
    expect(child.querySelector('input, .gis-ui-layer-locate, .gis-ui-layer-grip, .gis-ui-layer-expand')).toBeNull()
    expect(settings.querySelector('button[aria-label="切换图层显隐 Nested child"]')).not.toBeNull()
    child.querySelector<HTMLButtonElement>('button')!.click(); await nextTick()
    expect(app.layers.get('a')!.visible).toBe(false)
    expect(app.layers.get('b')!.visible).toBe(true)
    const locate = row.querySelector<HTMLButtonElement>('.gis-ui-layer-locate')!
    expect(locate.disabled).toBe(true)
    expect(locate.querySelector('svg')).not.toBeNull()
    const slider = row.querySelector<HTMLInputElement>('input[type="range"]')!
    expect(row.querySelector('output')!.textContent).toBe('混合')
    slider.value = '42'; slider.dispatchEvent(new Event('input', { bubbles: true })); await flushPromises()
    expect(app.layers.get('a')!.getMetadata().opacity).toBe(0.42)
    expect(app.layers.get('b')!.getMetadata().opacity).toBe(0.42)
    expect(app.layers.get('c')!.getMetadata().opacity).toBe(0.42)
    expect(useOLMap(app).getLayers().getArray().find(layer => layer.get('gisLayerId') === 'a')!.getOpacity()).toBe(0.42)
    await app.layers.update('a', { options: { opacity: 0 } }); await nextTick()
    expect(row.querySelector('output')!.textContent).toBe('混合')
    const group = target.querySelector<HTMLButtonElement>('button[aria-label="图层配置 Group"]')!
    const groupRow = group.closest('.gis-ui-layer-row')!
    expect(groupRow.querySelector('output')!.textContent).toBe('混合')
    const groupSlider = groupRow.querySelector<HTMLInputElement>('input[type="range"]')!
    groupSlider.value = '50'; groupSlider.dispatchEvent(new Event('input', { bubbles: true })); await flushPromises()
    expect(app.layers.get('a')!.getMetadata().opacity).toBe(0.5)
    expect(app.layers.get('b')!.getMetadata().opacity).toBe(0.5)
    expect(groupRow.querySelector('output')!.textContent).toBe('50%')
    group.click(); await nextTick()
    expect(target.querySelector('button[aria-label="切换图层显隐 Layer A"]')).toBeNull()
  } finally { await app.dispose(); target.remove() }
})
