import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import LegendEditor from '../src/components/LegendEditor.vue'
import type { LegendEditValue } from '../src/components/legend-editor-types.js'

const style = Object.freeze({ fillColor: '#0000ff', strokeColor: '#111111', strokeWidth: 2, pointRadius: 6 })
it('edits enum drafts with native color controls and preserves full style until submit', async () => {
  const legend = Object.freeze({ type: 'category' as const, field: 'kind', items: Object.freeze([Object.freeze({ id: 'one', value: 'a', label: 'One', color: '#0000ff' })]) })
  const wrapper = mount(LegendEditor, { props: { legend, layerStyle: style } })
  try {
    await wrapper.get('input[aria-label="Color 1"]').setValue('#ff0000')
    await wrapper.get('input[name="itemLabel-0"]').setValue('Renamed')
    expect(wrapper.find('button[aria-label="Reset"]').exists()).toBe(false)
    expect(wrapper.emitted('submit')).toBeUndefined()
    await wrapper.get('input[aria-label="Unmatched values"]').setValue('#00ff00')
    await wrapper.get('form').trigger('submit')
    const value = wrapper.emitted('submit')![0]![0] as LegendEditValue
    expect(value.style).toEqual({ ...style, fillColor: '#00ff00' })
    expect(value.legend?.items?.[0]).toMatchObject({ label: 'Renamed', values: ['a'] })
    expect(legend.items[0]!.label).toBe('One')
    expect(style.fillColor).toBe('#0000ff')
    await wrapper.get('button[aria-label="Close"]').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.find('input[name="legendTitle"]').exists()).toBe(false)
    expect(wrapper.find('select[name="legendType"]').exists()).toBe(false)
  } finally { wrapper.unmount() }
})

it('edits grouped values through a multi-select, keeps titles/type fixed and protects other groups', async () => {
  const original = { type: 'category' as const, title: 'Legend label', field: 'kind', items: [
    { id: 'a', label: 'Cities', values: ['urban', 'suburban'], color: '#00ff00' },
    { id: 'b', label: 'Regions', values: ['regional'], color: '#ff0000' },
  ] }
  const wrapper = mount(LegendEditor, { props: { title: 'Sampling sites', legend: original, fields: [{ name: 'kind', type: 'string' }], getFieldValues: () => ['urban', 'suburban', 'regional', 'new'] }, attachTo: document.body })
  try {
    expect(wrapper.get('h3').text()).toBe('Sampling sites')
    expect(wrapper.find('input[name="legendTitle"]').exists()).toBe(false)
    expect(wrapper.find('[name="legendType"]').exists()).toBe(false)
    await wrapper.get('[aria-label="Matching values 1"]').trigger('click')
    expect(document.querySelector('[role="option"][aria-label="regional"]')?.getAttribute('aria-disabled')).toBe('true')
    document.querySelector<HTMLElement>('[role="option"][aria-label="new"]')!.click(); await nextTick()
    document.querySelector<HTMLInputElement>('.gis-ui-multi-search input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await nextTick()
    await wrapper.get('form').trigger('submit')
    const value = wrapper.emitted('submit')![0]![0] as LegendEditValue
    expect(value.legend?.items?.[0]?.values).toEqual(['urban', 'suburban', 'new'])
    expect(value.legend?.title).toBe('Legend label')
    expect(original.items[0]?.values).toEqual(['urban', 'suburban'])
  } finally { wrapper.unmount() }
})

it('adds and removes intervals, validates overlaps and sorts boundaries on save', async () => {
  const wrapper = mount(LegendEditor, { props: { layerStyle: style, legend: { type: 'interval', field: 'count', ranges: [
    { id: 'a', min: 0, max: 100, color: '#ff0000' },
  ] } } })
  try {
    await wrapper.get('.gis-ui-legend-add').trigger('click')
    expect((wrapper.get('input[name="rangeMin-1"]').element as HTMLInputElement).value).toBe('100')
    await wrapper.get('input[name="rangeMin-1"]').setValue('50')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain('non-overlapping')
    await wrapper.get('input[name="rangeMin-1"]').setValue('100')
    await wrapper.get('form').trigger('submit')
    const value = wrapper.emitted('submit')![0]![0] as LegendEditValue
    expect(value.legend?.ranges).toHaveLength(2)
    await wrapper.get('button[aria-label="Delete 1"]').trigger('click')
    expect(wrapper.findAll('.gis-ui-legend-rule-row')).toHaveLength(1)
  } finally { wrapper.unmount() }
})

it('stages advanced area styling in the legend draft and discards cancelled changes', async () => {
  const wrapper = mount(LegendEditor, {
    props: { layerStyle: style, symbol: 'fill', legend: { type: 'category', items: [{ id: 'area', label: 'Area' }] } },
    attachTo: document.body,
  })
  try {
    await wrapper.get('.gis-ui-legend-more').trigger('click')
    await wrapper.get('dialog input[type="number"]').setValue('19')
    await wrapper.get('dialog button[type="button"]:not(.gis-ui-legend-action)').trigger('click')
    expect(wrapper.find('dialog').exists()).toBe(false)
    await wrapper.get('.gis-ui-legend-more').trigger('click')
    expect((wrapper.get('dialog input[type="number"]').element as HTMLInputElement).value).toBe('100')
    await wrapper.get('dialog input[type="number"]').setValue('40')
    await wrapper.get('dialog select').setValue('dashed')
    await wrapper.get('dialog form').trigger('submit')
    expect(wrapper.emitted('submit')).toBeUndefined()
    await wrapper.get('.gis-ui-legend-editor').trigger('submit')
    const value = wrapper.emitted('submit')![0]![0] as LegendEditValue
    expect(value.style).toEqual({ ...style, fillOpacity: 0.4, lineDash: 'dashed' })
  } finally { wrapper.unmount() }
})
