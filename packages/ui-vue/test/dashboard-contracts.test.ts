import { expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { createGISApp } from '@joinmap/gis-core'
import { createFakeMapPlugin, createFakeLayerDefinition, FakeMapAdapter } from '../../core/test/fake-map.js'
import { createVueUI } from '../src/vue-ui.js'
import type { GISUIContext } from '../src/types.js'

it('reserves configured side widths, normalizes numeric heights and responds to visibility/theme changes', async () => {
  const app = createGISApp()
  let ui!: GISUIContext
  app.use(createFakeMapPlugin())
  app.use(createVueUI({ config: { layout: 'overlay-dashboard', theme: { tokens: { panelWidth: '280px', overlayPanelWidth: '290px' } } },
    extensions: [{ name: 'capture', install: context => { ui = context } }],
    panelDefinitions: [320, 360].map((width, i) => ({ id: `panel-${i}`, width, height: 120, position: 'left', defaultVisible: true,
      component: defineComponent({ render: () => h('p', 'Content') }) })),
  }))
  const target = document.createElement('div'); document.body.append(target)
  try {
    await app.init({ ui: { panels: [{ id: 'panel-0', width: 340 }] } })
    await app.mount(target)
    const root = target.querySelector<HTMLElement>('.gis-ui-root')!
    expect(root.style.getPropertyValue('--gis-ui-panel-width')).toBe('280px')
    expect(root.style.getPropertyValue('--gis-ui-overlay-panel-width')).toBe('290px')
    expect(root.style.getPropertyValue('--gis-ui-configured-left-width')).toBe('max(340px, 360px)')
    const host = target.querySelector<HTMLElement>('.gis-ui-panel-host--panel-0')!
    expect(host.style.height).toBe('120px')
    expect(host.style.width).toBe('100%')
    expect(host.querySelector<HTMLElement>('.gis-ui-panel-shell')!.style.height).toBe('')
    ui.panels.hide('panel-1'); await nextTick()
    expect(root.style.getPropertyValue('--gis-ui-configured-left-width')).toBe('340px')
    ui.panels.hide('panel-0'); ui.theme.set({ tokens: { panelWidth: '310px' } }); await nextTick()
    expect(root.style.getPropertyValue('--gis-ui-configured-left-width')).toBe('')
    expect(root.style.getPropertyValue('--gis-ui-panel-width')).toBe('310px')
  } finally { await app.dispose(); target.remove() }
})

it('keeps the overlay rail and drawer widths independent and honors explicit panel positions', async () => {
  const app = createGISApp()
  let ui!: GISUIContext
  app.use(createFakeMapPlugin())
  app.use(createVueUI({ config: { layout: 'overlay-dashboard', panels: [{ id: 'legend', position: 'left' }] },
    extensions: [{ name: 'capture', install: context => { ui = context } }],
  }))
  const target = document.createElement('div'); document.body.append(target)
  try {
    await app.init({ ui: { panels: [{ id: 'layer-manager', width: 240 }, { id: 'properties', width: 320 }] } })
    await app.mount(target)
    const root = target.querySelector<HTMLElement>('.gis-ui-root')!
    expect(root.style.getPropertyValue('--gis-ui-configured-right-width')).toBe('240px')
    expect(root.style.getPropertyValue('--gis-ui-configured-drawer-width')).toBe('320px')
    expect(target.querySelector('.gis-ui-overlay--left .gis-ui-panel-host--legend')).not.toBeNull()
    ui.panels.show('properties'); await nextTick()
    expect(root.style.getPropertyValue('--gis-ui-configured-right-width')).toBe('240px')
    expect(target.querySelectorAll('.gis-ui-panel-host--properties')).toHaveLength(1)
    expect(target.querySelector('.gis-ui-overlay--drawer .gis-ui-panel-host--properties')).not.toBeNull()
  } finally { await app.dispose(); target.remove() }
})

