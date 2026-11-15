import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import LegendEditor from '../src/components/LegendEditor.vue'
import type { LegendEditValue } from '../src/components/legend-editor-types.js'

const style = Object.freeze({ fillColor: '#0000ff', strokeColor: '#111111', strokeWidth: 2, pointRadius: 6 })
it('edits enum drafts with native color controls and preserves full style; reset and cancel do not commit', async () => {
  const legend = Object.freeze({ type: 'category' as const, field: 'kind', items: Object.freeze([Object.freeze({ id: 'one', value: 'a', label: 'One', color: '#0000ff' })]) })
  const wrapper = mount(LegendEditor, { props: { legend, layerStyle: style } })
  try {
    await wrapper.get('input[aria-label="Color 1"]').setValue('#ff0000')
    await wrapper.get('input[name="itemLabel-0"]').setValue('Renamed')
    await wrapper.get('button[aria-label="Reset"]').trigger('click')
    expect((wrapper.get('input[name="itemLabel-0"]').element as HTMLInputElement).value).toBe('One')
    expect(wrapper.emitted('submit')).toBeUndefined()
    await wrapper.get('input[aria-label="Other values"]').setValue('#00ff00')
    await wrapper.get('input[name="itemLabel-0"]').setValue('Renamed')
    await wrapper.get('form').trigger('submit')
    const value = wrapper.emitted('submit')![0]![0] as LegendEditValue
    expect(value.style).toEqual({ ...style, fillColor: '#00ff00' })
    expect(value.legend?.items?.[0]).toMatchObject({ label: 'Renamed', value: 'a' })
    expect(legend.items[0]!.label).toBe('One')
    expect(style.fillColor).toBe('#0000ff')
    await wrapper.get('button[aria-label="Close"]').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.get('button[title="More settings coming soon"]').attributes('disabled')).toBeDefined()
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
