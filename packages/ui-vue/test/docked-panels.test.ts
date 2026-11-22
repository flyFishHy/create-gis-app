import { expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createGISApp } from '@joinmap/gis-core'
import { createVueUI } from '../src/vue-ui.js'
import { createFakeMapPlugin } from '../../core/test/fake-map.js'

it('shows docked Properties by default, closes it and retains it when selection clears', async () => {
  const app = createGISApp()
  app.use(createFakeMapPlugin())
  app.use(createVueUI())
  const target = document.createElement('div')
  document.body.append(target)
  const properties = () => target.querySelector('.gis-ui-panel-host--properties')
  try {
    await app.init({ ui: { layout: 'docked-dashboard' } })
    await app.mount(target)
    expect(properties()).not.toBeNull()
    const actions = target.querySelector('.gis-ui-map-actions')!
    expect(actions.querySelector('.gis-ui-panel-host--search')).not.toBeNull()
    expect(actions.querySelector('.gis-ui-panel-host--time')).not.toBeNull()
    expect(actions.querySelector('.gis-ui-toolbar-host .gis-ui-panel-host--toolbar')).not.toBeNull()
    expect(actions.querySelectorAll('.gis-ui-panel-host')).toHaveLength(3)
    expect(properties()!.querySelector('.gis-ui-panel-close')).not.toBeNull()
    expect(properties()!.textContent).toContain('未选中空间要素')
    properties()!.querySelector<HTMLButtonElement>('.gis-ui-panel-close')!.click()
    await nextTick()
    expect(target.querySelector('.gis-ui-workspace.is-right-hidden')).not.toBeNull()
    expect(properties()).toBeNull()
    app.interactions.select({ feature: { layerId: 'external', id: 'one' } })
    await nextTick()
    expect(properties()).not.toBeNull()
    expect(target.querySelector('.gis-ui-workspace.is-right-hidden')).toBeNull()
    app.interactions.clearSelection()
    await nextTick()
    expect(properties()).not.toBeNull()
  } finally {
    await app.dispose()
    target.remove()
  }
})
