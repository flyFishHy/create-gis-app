import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { createGISApp } from '@joinmap/gis-core'
import { createVueUI } from '../src/vue-ui.js'
import { createFakeLayerDefinition, createFakeMapPlugin } from '../../core/test/fake-map.js'

describe('Dashboard status and query placement', () => {
  it('shows the selected layer title from config and follows runtime renaming, with a fallback for external selections', async () => {
    const app = createGISApp()
    app.use(createFakeMapPlugin(undefined, { test: createFakeLayerDefinition() })); app.use(createVueUI())
    const target = document.createElement('div'); document.body.append(target)
    try {
      await app.init({ layers: [{ id: 'group', title: 'Group', type: 'GROUP', children: [{ id: 'child', title: 'Child layer title', type: 'test' }] }] })
      await app.mount(target)
      const title = () => target.querySelector('.gis-ui-properties-layer-title')
      expect(title()).toBeNull()
      app.interactions.select({ feature: { layerId: 'child', id: 1, properties: { name: 'Sample' } } }); await nextTick()
      expect(title()?.textContent).toBe('Child layer title')
      await app.layers.update('child', { title: 'Renamed layer' }); await nextTick()
      expect(title()?.textContent).toBe('Renamed layer')
      app.interactions.select({ feature: { source: 'custom', layerId: 'external', properties: {} } }); await nextTick()
      expect(title()?.textContent).toBe('external')
      app.interactions.clearSelection(); await nextTick()
      expect(title()).toBeNull()
    } finally { await app.dispose(); target.remove() }
  })
  it('shares custom feature renderers between Properties and Popup', async () => {
    const app = createGISApp()
    app.use(createFakeMapPlugin())
    app.use(createVueUI({ config: { panels: [{ id: 'popup', visible: true }] }, extensions: [{
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
      config: { layout, panels: [{ id: 'properties', visible: true }] },
      toolbarItems: [{ id: 'zoom', title: 'Zoom in', icon: 'zoom-in', onClick: () => app.map.getView().setZoom(5.5) }],
      panelDefinitions: [{ id: 'properties', title: 'Properties', position: 'right', defaultVisible: true, component: defineComponent({ render: () => h('p', 'Properties') }) }],
    }))
    const target = document.createElement('div')
    document.body.append(target)
    try {
      await app.init({ map: { center: [0, 0], zoom: 3 } })
      await app.mount(target)
      const status = target.querySelector('.gis-ui-status-content')!
      expect(status.querySelectorAll('.gis-ui-status-label')).toHaveLength(4)
      expect(status.querySelectorAll('output')).toHaveLength(4)
      expect([...status.querySelectorAll('.gis-ui-status-text')].map(label => label.textContent)).toEqual(['级别', '比例尺', '投影', '经纬度'])
      expect(status.querySelectorAll('.gis-ui-status-label .gis-ui-svg-icon svg')).toHaveLength(4)
      expect(status.querySelector('.gis-ui-status-level .lucide-scan')).not.toBeNull()
      expect(status.querySelector('.gis-ui-status-projection .lucide-globe')).not.toBeNull()
      expect(status.querySelector('.gis-ui-status-level .gis-ui-status-text')!.textContent).toBe('级别')
      expect(status.querySelector('.gis-ui-status-projection .gis-ui-status-text')!.textContent).toBe('投影')
      expect(status.querySelector('.gis-ui-status-coordinates output')!.textContent).toBe('--')
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
        expect(target.querySelector('.gis-ui-overlay--right .gis-ui-panel-host--layer-manager')).not.toBeNull()
        expect(target.querySelector('.gis-ui-overlay--right .gis-ui-panel-host--legend')).not.toBeNull()
        expect(target.querySelector('.gis-ui-overlay--drawer .gis-ui-panel-host--properties')).not.toBeNull()
        expect(target.querySelector('.gis-ui-overlay--right .gis-ui-panel-region')!.firstElementChild?.classList.contains('gis-ui-panel-host--layer-manager')).toBe(true)
        expect(target.querySelector('.gis-ui-overlay-controls.has-drawer')).not.toBeNull()
      }
    } finally { await app.dispose(); target.remove() }
  })

  it('opens properties on selection, preserves selection on close and reopens on the next pick', async () => {
    const app = createGISApp()
    app.use(createFakeMapPlugin())
    app.use(createVueUI({ config: { layout: 'overlay-dashboard' } }))
    const target = document.createElement('div')
    document.body.append(target)
    const drawer = () => target.querySelector('.gis-ui-panel-host--properties')
    try {
      await app.init({ map: { center: [0, 0], zoom: 3 } })
      await app.mount(target)
      expect(drawer()).toBeNull()
      const rail = target.querySelector('.gis-ui-overlay--right')!
      const layers = rail.querySelector('.gis-ui-panel-host--layer-manager')!
      const legend = rail.querySelector('.gis-ui-panel-host--legend')!
      const expectStableRail = () => {
        expect(rail.querySelector('.gis-ui-panel-host--layer-manager')).toBe(layers)
        expect(rail.querySelector('.gis-ui-panel-host--legend')).toBe(legend)
        expect(target.querySelectorAll('.gis-ui-panel-host--legend')).toHaveLength(1)
        expect(rail.querySelector('.gis-ui-panel-host--properties')).toBeNull()
      }
      app.interactions.select({ feature: { id: 'one', layerId: 'sample', properties: { name: 'First' } } })
      await nextTick()
      expect(drawer()?.textContent).toContain('First')
      expect(target.querySelector('.gis-ui-overlay--drawer')?.contains(drawer())).toBe(true)
      expect(target.querySelector('.gis-ui-overlay-controls.has-drawer')).not.toBeNull()
      expectStableRail()
      drawer()!.querySelector<HTMLButtonElement>('.gis-ui-panel-close')!.click()
      await nextTick()
      expect(drawer()?.classList.contains('gis-ui-panel-leave-active')).toBe(true)
      expect(target.querySelector('.gis-ui-overlay-controls.has-drawer')).toBeNull()
      await vi.waitFor(() => expect(drawer()).toBeNull())
      expectStableRail()
      expect(app.interactions.getSelection()?.id).toBe('one')
      app.map.getView().setZoom(4)
      await nextTick()
      expect(drawer()).toBeNull()
      app.interactions.select({ feature: { id: 'one', layerId: 'sample', properties: { name: 'First' } } })
      await nextTick()
      expect(drawer()).not.toBeNull()
      app.interactions.clearSelection()
      await nextTick()
      await vi.waitFor(() => expect(drawer()).toBeNull())
      await app.unmount()
      await app.mount(target)
      app.interactions.select({ feature: { id: 'two', layerId: 'sample', properties: { name: 'Second' } } })
      await nextTick()
      expect(drawer()?.textContent).toContain('Second')
    } finally { await app.dispose(); target.remove() }
  })
})
