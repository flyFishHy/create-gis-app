import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { createGISApp } from '@joinmap/gis-core'
import type { SearchResult } from '@joinmap/gis-core'
import { createVueUI } from '../src/vue-ui.js'
import { createFakeLayerDefinition, createFakeMapPlugin } from '../../core/test/fake-map.js'

it('selects searchable layer titles, scopes queries and clears pending results when the layer changes', async () => {
  const app = createGISApp()
  app.use(createFakeMapPlugin(undefined, { test: createFakeLayerDefinition() })); app.use(createVueUI())
  let resolveOld!: (results: SearchResult[]) => void
  let oldSignal: AbortSignal | undefined
  const a = vi.fn(({ signal }: { signal?: AbortSignal }) => { oldSignal = signal; return new Promise<SearchResult[]>(resolve => { resolveOld = resolve }) })
  const b = vi.fn(async () => [{ id: 'b', layerId: 'b', title: 'B match' }])
  app.search.registerProvider({ id: 'a', layerIds: ['a'], search: a })
  app.search.registerProvider({ id: 'b', layerIds: ['b'], search: b })
  const target = document.createElement('div'); document.body.append(target)
  try {
    await app.init({ layers: [{ id: 'a', title: 'Layer A', type: 'test' }, { id: 'b', title: 'Layer B', type: 'test' }, { id: 'tiles', title: 'Not searchable', type: 'test' }] })
    await app.mount(target)
    const select = target.querySelector<HTMLButtonElement>('.gis-ui-search-layer [role="combobox"]')!
    expect(select.textContent).toContain('Layer A')
    select.click(); await nextTick()
    expect([...target.querySelectorAll('[role="option"] > span:first-child')].map(option => option.textContent)).toEqual(['Layer A', 'Layer B'])
    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await nextTick()
    const input = target.querySelector<HTMLInputElement>('input[type="search"]')!
    input.value = 'match'; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
    const form = target.querySelector('form')!
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flushPromises()
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'match', layerId: 'a' }))
    select.click(); await nextTick()
    target.querySelectorAll<HTMLElement>('[role="option"]')[1]!.click(); await nextTick()
    expect(oldSignal?.aborted).toBe(true)
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flushPromises()
    expect(b).toHaveBeenCalledWith(expect.objectContaining({ layerId: 'b' }))
    expect(target.querySelector('.gis-ui-search-results')?.textContent).toContain('B match')
    resolveOld([{ id: 'old', title: 'Old A match' }]); await flushPromises()
    expect(target.querySelector('.gis-ui-search-results')?.textContent).not.toContain('Old A match')
    select.focus(); select.click(); await nextTick()
    expect(target.querySelector('.gis-ui-search-feedback')).toBeNull()
    expect(target.querySelector('[role="listbox"]')).not.toBeNull()
    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await nextTick()
    expect(target.querySelector('[role="listbox"]')).toBeNull()
    expect(target.querySelector('.gis-ui-search-feedback')).toBeNull()
    await app.layers.update('b', { title: 'Renamed B' }); await nextTick()
    expect(select.textContent).toContain('Renamed B')
    await app.layers.remove('b'); await nextTick()
    expect(select.textContent).toContain('Layer A')
    expect(target.querySelector('.gis-ui-search-results')).toBeNull()
  } finally { await app.dispose(); target.remove() }
})

it('observes provider registration and removal, cancels old UI queries and preserves providers across remounts', async () => {
  const app = createGISApp()
  app.use(createFakeMapPlugin())
  app.use(createVueUI())
  const target = document.createElement('div'); document.body.append(target)
  let oldResult!: (value: SearchResult[]) => void
  try {
    await app.init({}); await app.mount(target)
    const input = target.querySelector<HTMLInputElement>('input[type="search"]')!
    const submit = target.querySelector<HTMLButtonElement>('button[type="submit"]')!
    input.value = 'first'; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
    expect(submit.disabled).toBe(true)
    const remove = app.search.registerProvider({ id: 'live', search: ({ keyword }) => keyword === 'first'
      ? new Promise(resolve => { oldResult = resolve }) : Promise.resolve([{ id: 'latest', title: 'Latest' }]) })
    await nextTick(); expect(submit.disabled).toBe(false)
    const form = target.querySelector('form')!
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flushPromises()
    input.value = 'second'; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flushPromises()
    expect(target.textContent).toContain('Latest')
    oldResult([{ id: 'stale', title: 'Stale' }]); await flushPromises()
    expect(target.textContent).not.toContain('Stale')
    await app.unmount(); await app.mount(target)
    expect(app.search.listProviders()).toHaveLength(1)
    remove(); await nextTick()
    const remountedInput = target.querySelector<HTMLInputElement>('input[type="search"]')!
    remountedInput.value = 'again'; remountedInput.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
    expect(target.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
  } finally { await app.dispose(); target.remove() }
})
