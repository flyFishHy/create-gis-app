import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createGISApp } from '@joinmap/gis-core'
import { createOLAdapter, useOLMap, useOLTools } from '../../adapter-ol/src/index.js'
import { createVueUI } from '../src/vue-ui.js'

describe('Header switches', () => {
  it.each(['docked-dashboard', 'overlay-dashboard'])('switches theme and language from the %s settings', async (layoutName) => {
    const app = createGISApp()
    app.use(createVueUI())
    const target = document.createElement('div')
    document.body.append(target)
    try {
      await app.init({ title: { content: '空间态势工作台', subtitle: '多源数据监测' }, ui: { layout: layoutName } })
      await app.mount(target)

      const layout = target.querySelector<HTMLElement>('.gis-ui-layout')!
      const header = target.querySelector<HTMLElement>('header.gis-ui-title')!
      const actions = header.querySelector('.gis-ui-header-actions')!
      const popover = actions.querySelector('.gis-ui-appearance')!
      const themeSwitch = popover.querySelector<HTMLElement>('[aria-label="主题模式"]')!
      const languageSwitch = popover.querySelector<HTMLElement>('[aria-label="语言"]')!
      const layerTitle = target.querySelector<HTMLElement>('.gis-ui-panel-host--layer-manager .gis-ui-panel-title')!
      expect(actions.querySelectorAll(':scope > button')).toHaveLength(1)
      expect(header.querySelector('.gis-ui-brand-subtitle')?.textContent).toBe('多源数据监测')
      expect(themeSwitch.querySelectorAll('button')).toHaveLength(2)

      expect(layout.classList.contains('gis-ui-theme-light')).toBe(true)
      expect(layerTitle.textContent).toContain('图层')

      themeSwitch.querySelector<HTMLButtonElement>('button[aria-label="深色"]')!.click()
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

it('switches built-in layouts in place and retains settings, map view and selection', async () => {
  const app = createGISApp().use(createOLAdapter()).use(createVueUI())
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const target = document.createElement('div')
  document.body.append(target)
  try {
    await app.init({ map: { center: [1, 2], zoom: 4 }, ui: { layout: 'overlay-dashboard' } })
    await app.mount(target)
    const map = useOLMap(app)
    const tools = useOLTools(app)
    tools.importResults([{ id: 'point', toolId: 'draw-point', projection: 'EPSG:3857', geometry: { type: 'Point', coordinates: [1, 2] } }])
    tools.select('point')
    await nextTick()
    const header = target.querySelector('.gis-ui-title')!
    const popover = header.querySelector('.gis-ui-appearance')!
    const gear = header.querySelector('.gis-ui-appearance-trigger')!
    popover.dispatchEvent(Object.assign(new Event('beforetoggle'), { newState: 'open' }))

    popover.querySelector<HTMLButtonElement>('button[aria-label="停靠"]')!.click()
    await nextTick()
    expect(target.querySelector('.gis-ui-layout--docked .gis-ui-title')).toBe(header)
    expect(header.querySelector('.gis-ui-appearance')).toBe(popover)
    expect(gear.getAttribute('aria-expanded')).toBe('true')
    expect(map.getTargetElement()).toBe(target.querySelector('.gis-ui-map-viewport'))
    expect(map.getView().getCenter()).toEqual([1, 2])
    expect(map.getView().getZoom()).toBe(4)
    expect(tools.list()).toHaveLength(1)
    expect(tools.selected()).toBe('point')
    expect(target.querySelector('.gis-ui-right-region .gis-ui-panel-host--properties')).not.toBeNull()
    expect(app.context.state.snapshot().extensions['vue-ui']).toMatchObject({ layout: 'docked-dashboard' })

    popover.querySelector<HTMLButtonElement>('button[aria-label="浮动"]')!.click()
    await nextTick()
    expect(target.querySelector('.gis-ui-layout--overlay .gis-ui-title')).toBe(header)
    expect(target.querySelector('.gis-ui-overlay--drawer .gis-ui-panel-host--properties')).not.toBeNull()
    expect(tools.selected()).toBe('point')
  } finally {
    await app.dispose()
    target.remove()
    vi.unstubAllGlobals()
  }
})

it('updates panel material and the shared primary color from the header popover', async () => {
  const app = createGISApp().use(createVueUI())
  const target = document.createElement('div')
  document.body.append(target)
  try {
    await app.init({ ui: { layout: 'overlay-dashboard', theme: { tokens: { panelOpacity: '68%' } } } })
    await app.mount(target)
    const layout = target.querySelector<HTMLElement>('.gis-ui-layout')!
    const gear = target.querySelector<HTMLButtonElement>('.gis-ui-header-actions button[aria-label="设置"]')!
    const popover = target.querySelector<HTMLElement>('.gis-ui-appearance')!
    const option = (label: string) => popover.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
    const slider = (label: string) => Array.from(popover.querySelectorAll('label')).find(el => el.firstElementChild?.textContent === label)?.querySelector('input')

    expect(gear.textContent?.trim()).toBe('')
    expect(gear.getAttribute('popovertarget')).toBe(popover.id)
    expect(popover.getAttribute('popover')).toBe('auto')
    expect(option('磨砂玻璃').getAttribute('aria-pressed')).toBe('true')
    expect(slider('背景不透明度')?.value).toBe('68')
    expect(slider('液态高光强度')).toBeUndefined()

    option('液态玻璃').click()
    await nextTick()
    expect(layout.dataset.gisUiPanelStyle).toBe('liquid')
    const specular = slider('液态高光强度')!
    specular.value = '60'
    specular.dispatchEvent(new Event('input'))
    option('翡翠绿').click()
    await nextTick()
    expect(layout.style.getPropertyValue('--gis-ui-primary')).toBe('#10b981')
    expect(layout.style.getPropertyValue('--gis-ui-liquid-specular')).toBe('60%')

    option('实际颜色').click()
    await nextTick()
    expect(layout.dataset.gisUiPanelStyle).toBe('solid')
    expect(slider('模糊半径')?.disabled).toBe(true)
    expect(slider('背景不透明度')?.min).toBe('94')
    expect(slider('背景不透明度')?.value).toBe('94')
    expect(slider('液态高光强度')).toBeUndefined()

    const color = popover.querySelector<HTMLInputElement>('input[type="color"]')!
    color.value = '#111111'
    color.dispatchEvent(new Event('input'))
    await nextTick()
    expect(layout.style.getPropertyValue('--gis-ui-on-primary')).toBe('#fff')
    expect(app.context.state.snapshot().extensions['vue-ui']).toMatchObject({
      theme: { tokens: { panelStyle: 'solid', panelOpacity: '68%', panelSpecular: '60%', colorPrimary: '#111111' } },
    })
  } finally {
    await app.dispose()
    target.remove()
  }
})
