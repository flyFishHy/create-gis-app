import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import LegendEditor from '../src/components/LegendEditor.vue'
import type { LegendEditValue } from '../src/components/legend-editor-types.js'

it('edits independent drafts without Runtime, validates colors and preserves complete styles', async () => {
  const legend = Object.freeze({ type: 'category' as const, useLayerStyle: true, items: Object.freeze([Object.freeze({ id: 'one', label: 'One', color: '#0000ff' })]) })
  const style = Object.freeze({ fillColor: '#0000ff', strokeColor: '#111111', strokeWidth: 2, pointRadius: 6 })
  const wrapper = mount(LegendEditor, { props: { legend, layerStyle: style } })
  try {
    await wrapper.get('input[name="fillColor"]').setValue('invalid-color')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain('valid colors')
    await wrapper.get('input[name="fillColor"]').setValue('#ff000080')
    await wrapper.get('input[name="itemLabel-0"]').setValue('Renamed')
    await wrapper.get('form').trigger('submit')
    const value = wrapper.emitted('submit')![0]![0] as LegendEditValue
    expect(value.style).toEqual({ ...style, fillColor: '#ff000080' })
    expect(value.legend?.items?.[0]?.label).toBe('Renamed')
    expect(legend.items[0]!.label).toBe('One')
    expect(style.fillColor).toBe('#0000ff')
    await wrapper.get('button[type="button"]').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  } finally { wrapper.unmount() }
})
