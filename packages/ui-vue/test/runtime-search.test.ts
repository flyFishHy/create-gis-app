import { expect, it } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { createGISApp } from '@joinmap/gis-core'
import type { SearchResult } from '@joinmap/gis-core'
import { createVueUI } from '../src/vue-ui.js'
import { createFakeMapPlugin } from '../../core/test/fake-map.js'

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
