import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createGISApp } from '@joinmap/gis-core'
import { createVueUI } from '../src/vue-ui.js'
import { PanelRegistry } from '../src/panels/panel-registry.js'
import PanelShell from '../src/components/PanelShell.vue'

const Content = defineComponent({ render: () => h('p', 'Panel content') })

describe('Vue panel system', () => {
  it('applies config overrides and supports registration cleanup and panel state changes', () => {
    const registry = new PanelRegistry([{ id: 'summary', visible: true, position: 'right', order: 7 }])
    const unregister = registry.register({ id: 'summary', title: 'Summary', component: Content, defaultVisible: false })
    expect(registry.getState('summary')).toMatchObject({ visible: true, position: 'right', order: 7 })
    registry.collapse('summary')
    expect(registry.getState('summary')?.collapsed).toBe(true)
    registry.expand('summary')
    registry.hide('summary')
    expect(registry.getState('summary')?.visible).toBe(false)
    unregister()
    unregister()
    expect(registry.get('summary')).toBeUndefined()
    expect(registry.getState('summary')).toBeUndefined()
  })

  it('rejects duplicate panel ids and invalid ordering requests', () => {
    const registry = new PanelRegistry()
    registry.register({ id: 'one', title: 'One', component: Content })
    registry.register({ id: 'two', title: 'Two', component: Content })
    expect(() => registry.register({ id: 'one', title: 'Duplicate', component: Content })).toThrow(/already registered/)
    expect(() => registry.setOrder(['one', 'one'])).toThrow(/more than once/)
    expect(() => registry.setOrder(['missing'])).toThrow(/not registered/)
  })

  it('renders PanelShell actions and hides content while collapsed', async () => {
    const wrapper = mount(PanelShell, {
      props: { title: 'Legend', collapsed: false, collapsible: true, closable: true },
      slots: { default: '<p>Legend rows</p>' },
    })
    expect(wrapper.text()).toContain('Legend rows')
    await wrapper.get('button[aria-expanded]').trigger('click')
    expect(wrapper.emitted('collapse')).toHaveLength(1)
    await wrapper.get('button[aria-label="Close panel"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    await wrapper.setProps({ collapsed: true })
    expect(wrapper.text()).not.toContain('Legend rows')
  })

  it('mounts, unmounts, and remounts the official Vue UI with the runtime', async () => {
    const app = createGISApp()
    const extensionCleanup = vi.fn()
    app.use(createVueUI({
      extensions: [{ name: 'test-extension', install: (ui) => {
        const unregister = ui.panels.register({ id: 'test-panel', title: 'Test', component: Content, defaultVisible: true })
        return () => { unregister(); extensionCleanup() }
      } }],
    }))
    await app.init({ ui: { layout: 'docked-dashboard' } })

    const firstTarget = document.createElement('div')
    document.body.append(firstTarget)
    await app.mount(firstTarget)
    expect(firstTarget.querySelector('.gis-ui-layout--docked')).not.toBeNull()
    expect(firstTarget.textContent).toContain('Test')

    await app.unmount()
    expect(firstTarget.innerHTML).toBe('')
    const secondTarget = document.createElement('div')
    document.body.append(secondTarget)
    await app.mount(secondTarget)
    expect(secondTarget.querySelector('.gis-ui-layout--docked')).not.toBeNull()
    await app.dispose()
    expect(extensionCleanup).toHaveBeenCalledOnce()
    expect(secondTarget.innerHTML).toBe('')
  })
})
