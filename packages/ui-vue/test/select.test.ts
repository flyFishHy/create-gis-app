import { expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import GisSelect from '../src/components/GisSelect.vue';

it('supports keyboard selection, Escape, Tab, typeahead, option changes and outside dismissal', async () => {
  const wrapper = mount(GisSelect, {
    attachTo: document.body,
    props: {
      modelValue: 'a',
      label: 'Search layer',
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
        { value: 'c', label: 'Charlie' },
      ],
    },
  });
  try {
    const trigger = wrapper.get('[role="combobox"]');
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    expect(trigger.attributes('aria-expanded')).toBe('true');
    expect(
      wrapper.findAll('[role="option"]').map((option) => option.attributes('aria-selected'))
    ).toEqual(['true', 'false', 'false']);
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    expect(trigger.attributes('aria-activedescendant')).toBe(
      wrapper.findAll('[role="option"]')[1]!.attributes('id')
    );
    await trigger.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('update:modelValue')).toEqual([['b']]);
    expect(trigger.attributes('aria-expanded')).toBe('false');
    await wrapper.setProps({ modelValue: 'b' });
    await trigger.trigger('keydown', { key: 'c' });
    await trigger.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['c']);
    await trigger.trigger('click');
    await trigger.trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    await trigger.trigger('keydown', { key: 'Home' });
    await trigger.trigger('keydown', { key: 'End' });
    expect(trigger.attributes('aria-activedescendant')).toBe(
      wrapper.findAll('[role="option"]')[2]!.attributes('id')
    );
    await trigger.trigger('keydown', { key: 'Tab' });
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    await trigger.trigger('click');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await nextTick();
    expect(trigger.attributes('aria-expanded')).toBe('false');
    await trigger.trigger('click');
    await wrapper.setProps({ options: [{ value: 'c', label: 'Renamed Charlie' }] });
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    await wrapper.setProps({ disabled: true });
    expect(trigger.attributes('disabled')).toBeDefined();
  } finally {
    wrapper.unmount();
  }
});
