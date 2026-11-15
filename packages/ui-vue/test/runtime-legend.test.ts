import { expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createGISApp } from '@joinmap/gis-core'
import { createFakeLayerDefinition, createFakeMapPlugin } from '../../core/test/fake-map.js'
import { createVueUI } from '../src/vue-ui.js'
import Legend from '../src/components/Legend.vue'

it('renders standalone legends without Runtime or UI injection', () => {
  const wrapper = mount(Legend, { props: { definitions: [
    { id: 'categories', type: 'category', items: [{ id: 'a', label: 'A', color: '#ff0000' }, { id: 'b', label: 'B', color: '#0000ff' }] },
    { id: 'gradient', type: 'continuous', stops: [{ value: 100, color: 'red' }, { value: 0, color: 'blue' }, { value: 20, color: 'green' }] },
    { id: 'interval', type: 'interval', stops: [{ value: 0, color: 'gray' }] },
  ] } })
  expect(wrapper.find('.gis-ui-legend-gradient').attributes('style')).toContain('20%')
  expect(wrapper.findAll('.gis-ui-legend-scale span').map(node => node.text())).toEqual(['0', '20', '100'])
  expect(wrapper.findAll('.gis-ui-legend-items li')).toHaveLength(2)
  expect(wrapper.findAll('.gis-ui-legend-stop')).toHaveLength(1)
  wrapper.unmount()
})

it('projects layer legends through immutable snapshots and updates the panel on add/update/hide/remove', async () => {
  const app = createGISApp()
  app.use(createFakeMapPlugin(undefined, { test: createFakeLayerDefinition() }))
  app.use(createVueUI())
  const target = document.createElement('div'); document.body.append(target)
  const panel = () => target.querySelector('.gis-ui-panel-host--legend')!
  try {
    await app.init({}); await app.mount(target)
    const original = { type: 'category' as const, items: [{ id: 'one', label: 'Before', color: '#ff0000' }] }
    await app.layers.add({ id: 'one', title: 'Layer one', type: 'test', legend: original })
    original.items[0]!.label = 'External mutation'
    await nextTick()
    expect(panel().textContent).toContain('Before')
    const historical = app.context.state.snapshot()
    const element = panel().querySelector('.gis-ui-legend-group')
    await app.layers.update('one', { title: 'Renamed', legend: { type: 'category', items: [{ id: 'one', label: 'After' }] } })
    await nextTick()
    expect(panel().querySelector('.gis-ui-legend-group')).toBe(element)
    expect(panel().textContent).toContain('Renamed')
    expect(panel().textContent).toContain('After')
    expect(historical.layers[0]!.legend?.items?.[0]?.label).toBe('Before')
    await expect(app.layers.update('one', { title: 'Invalid', legend: { type: 'category', items: [{ id: 'x', label: 'X' }, { id: 'x', label: 'Y' }] } })).rejects.toThrow()
    expect(app.layers.get('one')?.title).toBe('Renamed')
    app.layers.setVisibility('one', false); await nextTick()
    expect(panel().querySelector('.gis-ui-legend-group')).toBeNull()
    app.layers.setVisibility('one', true); await nextTick()
    expect(panel().textContent).toContain('After')
    await app.layers.update('one', { legend: null }); await nextTick()
    expect(app.layers.get('one')?.legend).toBeUndefined()
    await app.layers.remove('one'); await nextTick()
    expect(app.context.state.snapshot().layers).toHaveLength(0)
    expect(panel().querySelector('.gis-ui-legend-group')).toBeNull()
  } finally { await app.dispose(); target.remove() }
})
