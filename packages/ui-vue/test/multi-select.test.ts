import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import GisMultiSelect from '../src/components/GisMultiSelect.vue'
import type { SelectValue } from '../src/components/select-values.js'

it('selects typed values, keeps the menu open, searches and retains missing selections', async () => {
  const value = ref<SelectValue[]>(['missing'])
  const wrapper = mount(defineComponent({ setup: () => () => h(GisMultiSelect, {
    modelValue: value.value, 'onUpdate:modelValue': (next: SelectValue[]) => { value.value = next }, label: 'Values',
    options: [{ value: 1, label: 'Number one' }, { value: '1', label: 'String one' }, { value: false, label: 'False' }, { value: 'used', label: 'Used', disabled: true }],
  }) }), { attachTo: document.body })
  const option = (label: string) => document.querySelector<HTMLElement>(`[role="option"][aria-label="${label}"]`)!
  try {
    await wrapper.get('[role="combobox"]').trigger('click')
    expect(document.querySelector('.gis-ui-multi-menu')).not.toBeNull()
    expect(option('missing').title).toBe('Not in current data')
    option('Number one').click(); await nextTick()
    option('String one').click(); await nextTick()
    option('Used').click(); await nextTick()
    expect(value.value).toEqual(['missing', 1, '1'])
    expect(document.querySelector('[aria-multiselectable="true"]')).not.toBeNull()
    const search = document.querySelector<HTMLInputElement>('.gis-ui-multi-search input')!
    search.value = 'False'; search.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await nextTick()
    expect(value.value).toEqual(['missing', 1, '1', false])
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await nextTick()
    expect(document.querySelector('.gis-ui-multi-menu')).toBeNull()
    expect(document.activeElement).toBe(wrapper.get('button').element)
    await wrapper.get('button').trigger('click')
    wrapper.unmount()
    expect(document.querySelector('.gis-ui-multi-menu')).toBeNull()
  } finally { if (wrapper.exists()) wrapper.unmount() }
})
