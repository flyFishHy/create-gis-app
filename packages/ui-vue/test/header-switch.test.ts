import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createGISApp } from '@joinmap/gis-core'
import { createVueUI } from '../src/vue-ui.js'

describe('Header switches', () => {
  it('switches theme mode and language from the header controls', async () => {
    const app = createGISApp()
    app.use(createVueUI())
    const target = document.createElement('div')
    document.body.append(target)
    try {
      await app.init({ ui: { layout: 'docked-dashboard' } })
      await app.mount(target)

      const layout = target.querySelector<HTMLElement>('.gis-ui-layout')!
      const themeSwitch = target.querySelector<HTMLElement>('[aria-label="Theme"]')!
      const languageSwitch = target.querySelector<HTMLElement>('[aria-label="Language"]')!
      const layerTitle = target.querySelector<HTMLElement>('.gis-ui-panel-host--layer-manager .gis-ui-panel-title')!
      expect(themeSwitch.querySelectorAll('button')).toHaveLength(2)
      expect(themeSwitch.querySelector('button[aria-label="System"]')).toBeNull()

      expect(layout.classList.contains('gis-ui-theme-light')).toBe(true)
      expect(layerTitle.textContent).toContain('图层')

      themeSwitch.querySelector<HTMLButtonElement>('button[aria-label="Dark"]')!.click()
      await nextTick()
      expect(layout.classList.contains('gis-ui-theme-dark')).toBe(true)
      expect(app.context.state.snapshot().extensions['vue-ui']).toMatchObject({ theme: { mode: 'dark' } })

      languageSwitch.querySelector<HTMLButtonElement>('button[aria-label="English"]')!.click()
      await nextTick()
      expect(layerTitle.textContent).toContain('Layers')
      expect(app.context.state.snapshot().extensions['vue-ui']).toMatchObject({ locale: 'en' })
    } finally {
      await app.dispose()
      target.remove()
    }
  })
})
