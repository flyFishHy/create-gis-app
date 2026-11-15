import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createGISApp } from '@joinmap/gis-core'
import type { LayerTimeFilter } from '@joinmap/gis-core'
import { createVueUI } from '../src/vue-ui.js'
import { createFakeLayerDefinition, createFakeMapPlugin } from '../../core/test/fake-map.js'

it('reads discrete date/time values from layers and steps the active layer filter', async () => {
  let filter: LayerTimeFilter | undefined
  const setTimeFilter = vi.fn((value: LayerTimeFilter | undefined) => { filter = value })
  const values = [Date.UTC(2024, 0, 1), Date.UTC(2024, 1, 1), Date.UTC(2024, 2, 1)]
  const app = createGISApp()
  app.use(createFakeMapPlugin(undefined, { temporal: createFakeLayerDefinition(() => ({
    setVisible() {}, setZIndex() {}, dispose() {}, setTimeFilter,
    getTimeFilter: () => filter,
    getTimeDimensions: () => [{ field: 'observed_at', values }],
    getMetadata: () => ({ time: { dimensions: [{ field: 'observed_at', count: values.length, min: values[0], max: values.at(-1) }], filter: filter ?? null } }),
  })) }))
  app.use(createVueUI())
  const target = document.createElement('div'); document.body.append(target)
  try {
    await app.init({ layers: [{ id: 'events', title: 'Events', type: 'temporal' }] })
    await app.mount(target)
    await nextTick()
    const panel = target.querySelector('.gis-ui-layer-time')!
    expect(panel.textContent).toContain('Events · observed_at')
    expect(panel.querySelector('output')?.textContent).toContain('2024')
    expect(setTimeFilter).toHaveBeenLastCalledWith({ field: 'observed_at', start: values[2], end: values[2] })
    panel.querySelector<HTMLButtonElement>('button[aria-label="上一个时间点"]')!.click()
    await nextTick()
    expect(setTimeFilter).toHaveBeenLastCalledWith({ field: 'observed_at', start: values[1], end: values[1] })
    panel.querySelector<HTMLButtonElement>('button[aria-label="显示全部时间"]')!.click()
    await nextTick()
    expect(setTimeFilter).toHaveBeenLastCalledWith(undefined)
  } finally { await app.dispose(); target.remove() }
})

it('keeps a disabled empty state when no layer exposes date/time data', async () => {
  const app = createGISApp()
  app.use(createFakeMapPlugin()); app.use(createVueUI())
  const target = document.createElement('div'); document.body.append(target)
  try {
    await app.init({}); await app.mount(target)
    expect(target.querySelector<HTMLButtonElement>('.gis-ui-time-placeholder')?.disabled).toBe(true)
    expect(target.textContent).toContain('未发现日期时间字段')
  } finally { await app.dispose(); target.remove() }
})
