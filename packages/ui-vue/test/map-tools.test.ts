import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { createGISApp } from '@joinmap/gis-core'
import { createVueUI } from '../src/vue-ui.js'
import { createFakeMapPlugin } from '../../core/test/fake-map.js'
import { createPropertiesUI } from '../../../examples/basic-vue/src/properties-ui.js'

describe('Dashboard status and query placement', () => {
  it('shares custom feature renderers between Properties and Popup', async () => {
    const app = createGISApp()
    app.use(createFakeMapPlugin())
    app.use(createVueUI({ config: { panels: [{ id: 'popup', visible: true }] }, extensions: [createPropertiesUI(), {
      name: 'custom-details', install: ui => ui.featureRenderers.register({
        id: 'custom', match: feature => feature.source === 'custom',
        component: defineComponent({ props: ['feature'], setup: props => () => h('p', { class: 'custom-details' }, props.feature.properties.name) }),
      }),
    }] }))
    const target = document.createElement('div')
    document.body.append(target)
    try {
      await app.init({})
      await app.mount(target)
      app.interactions.select({ feature: { source: 'custom', layerId: 'external', properties: { name: 'Shared renderer' } } })
      await nextTick()
      expect(target.querySelectorAll('.custom-details')).toHaveLength(2)
      expect(target.querySelector('.gis-ui-panel-host--properties')!.textContent).toContain('Shared renderer')
    } finally { await app.dispose(); target.remove() }
  })
  it.each(['docked-dashboard', 'overlay-dashboard'] as const)('keeps zoom in status, time next to Search and panels in their default regions: %s', async layout => {
    const app = createGISApp()
    app.use(createFakeMapPlugin())
    app.use(createVueUI({
      config: { layout },
      toolbarItems: [{ id: 'zoom', title: 'Zoom in', icon: 'zoom-in', onClick: () => app.map.getView().setZoom(5.5) }],
      panelDefinitions: [{ id: 'properties', title: 'Properties', position: 'right', defaultVisible: true, component: defineComponent({ render: () => h('p', 'Properties') }) }],
    }))
    const target = document.createElement('div')
    document.body.append(target)
    try {
      await app.init({ map: { center: [0, 0], zoom: 3 } })
      await app.mount(target)
      const status = target.querySelector('.gis-ui-status-content')!
      expect(status.querySelectorAll('.gis-ui-status-label')).toHaveLength(5)
      expect(status.querySelectorAll('output')).toHaveLength(5)
      expect(status.querySelector('[aria-label="Map level"]')!.textContent).toBe('3')
      expect(target.querySelector('.gis-ui-toolbar [aria-label="Map level"]')).toBeNull()
      const query = target.querySelector('.gis-ui-query-controls')!
      expect(query.firstElementChild?.classList.contains('gis-ui-panel-region--top')).toBe(true)
      const time = query.querySelector<HTMLButtonElement>('.gis-ui-time-placeholder')!
      expect(query.querySelector('.gis-ui-panel-host--time')).not.toBeNull()
      expect(time.disabled).toBe(true)
      expect(time.querySelector('svg')).not.toBeNull()
      target.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')!.click()
      await nextTick()
      expect(status.querySelector('[aria-label="Map level"]')!.textContent).toBe('5.5')
      if (layout === 'overlay-dashboard') {
        expect(target.querySelector('.gis-ui-overlay--toolbar .gis-ui-toolbar')).not.toBeNull()
        expect(target.querySelector('.gis-ui-overlay--left .gis-ui-panel-host--layer-manager')).not.toBeNull()
        expect(target.querySelector('.gis-ui-overlay--left .gis-ui-panel-host--legend')).not.toBeNull()
        expect(target.querySelector('.gis-ui-overlay--right .gis-ui-panel-host--properties')).not.toBeNull()
        expect(target.querySelector('.gis-ui-overlay--left .gis-ui-panel-region')!.firstElementChild?.classList.contains('gis-ui-panel-host--layer-manager')).toBe(true)
      }
    } finally { await app.dispose(); target.remove() }
  })

  it('opens properties on selection, preserves selection on close and reopens on the next pick', async () => {
    const app = createGISApp()
    app.use(createFakeMapPlugin())
    app.use(createVueUI({ config: { layout: 'overlay-dashboard' }, extensions: [createPropertiesUI()] }))
    const target = document.createElement('div')
    document.body.append(target)
    const drawer = () => target.querySelector('.gis-ui-panel-host--properties')
    try {
      await app.init({ map: { center: [0, 0], zoom: 3 } })
      await app.mount(target)
      expect(drawer()).toBeNull()
      app.interactions.select({ feature: { id: 'one', layerId: 'sample', properties: { name: 'First' } } })
      await nextTick()
      expect(drawer()?.textContent).toContain('First')
      drawer()!.querySelector<HTMLButtonElement>('.gis-ui-panel-close')!.click()
      await nextTick()
      expect(drawer()).toBeNull()
      expect(app.interactions.getSelection()?.id).toBe('one')
      app.map.getView().setZoom(4)
      await nextTick()
      expect(drawer()).toBeNull()
      app.interactions.select({ feature: { id: 'one', layerId: 'sample', properties: { name: 'First' } } })
      await nextTick()
      expect(drawer()).not.toBeNull()
      app.interactions.clearSelection()
      await nextTick()
      expect(drawer()).toBeNull()
      await app.unmount()
      await app.mount(target)
      app.interactions.select({ feature: { id: 'two', layerId: 'sample', properties: { name: 'Second' } } })
      await nextTick()
      expect(drawer()?.textContent).toContain('Second')
    } finally { await app.dispose(); target.remove() }
  })
})
