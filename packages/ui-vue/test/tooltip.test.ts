import { afterEach, describe, expect, it, vi } from 'vitest';
import { h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import Tooltip from '../src/components/Tooltip.vue';

function mountTooltip() {
  return mount(Tooltip, {
    attachTo: document.body,
    props: { content: 'Zoom in' },
    slots: {
      default: ({ describedBy }: { describedBy?: string }) =>
        h('button', { 'aria-describedby': describedBy }, 'Action'),
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Tooltip', () => {
  it('positions a horizontal toolbar tip above its trigger when there is no room below', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      return this.classList.contains('gis-ui-tooltip-trigger')
        ? ({
            left: 100,
            right: 132,
            top: window.innerHeight - 40,
            bottom: window.innerHeight - 8,
            width: 32,
            height: 32,
          } as DOMRect)
        : ({ left: 0, right: 120, top: 0, bottom: 30, width: 120, height: 30 } as DOMRect);
    });
    const wrapper = mountTooltip();
    try {
      await wrapper.setProps({ placement: 'bottom' });
      const trigger = wrapper.get<HTMLElement>('.gis-ui-tooltip-trigger').element;
      trigger.style.setProperty('--gis-ui-font-size', '16px');
      trigger.style.setProperty('--gis-ui-material-filter', 'none');
      trigger.style.setProperty('--gis-ui-material-image', 'linear-gradient(white, gray)');
      trigger.style.setProperty('--gis-ui-material-border', '#cbd5e1');
      wrapper.get('button').element.focus();
      await nextTick();
      await nextTick();
      const tip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
      expect(tip.style.getPropertyValue('--gis-ui-font-size')).toBe('16px');
      expect(tip.style.getPropertyValue('--gis-ui-material-filter')).toBe('none');
      expect(tip.style.getPropertyValue('--gis-ui-material-image')).toContain('linear-gradient');
      expect(tip.style.getPropertyValue('--gis-ui-material-border')).toBe('#cbd5e1');
      expect(parseFloat(tip.style.left)).toBe(56);
      expect(parseFloat(tip.style.top)).toBe(window.innerHeight - 80);
    } finally {
      wrapper.unmount();
    }
  });

  it('delays hover, cancels pending display, and removes the teleported tip on unmount', async () => {
    vi.useFakeTimers();
    const wrapper = mountTooltip();
    try {
      await wrapper.get('.gis-ui-tooltip-trigger').trigger('pointerenter');
      await vi.advanceTimersByTimeAsync(100);
      await wrapper.get('.gis-ui-tooltip-trigger').trigger('pointerleave');
      await vi.advanceTimersByTimeAsync(180);
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
      await wrapper.get('.gis-ui-tooltip-trigger').trigger('pointerenter');
      await vi.advanceTimersByTimeAsync(179);
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Zoom in');
      expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('supports focus, accessible description, Escape dismissal, and viewport edge positioning', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      return this.classList.contains('gis-ui-tooltip-trigger')
        ? ({
            left: window.innerWidth - 40,
            right: window.innerWidth - 8,
            top: 10,
            bottom: 42,
            width: 32,
            height: 32,
          } as DOMRect)
        : ({ left: 0, right: 120, top: 0, bottom: 30, width: 120, height: 30 } as DOMRect);
    });
    const wrapper = mountTooltip();
    try {
      wrapper.get('button').element.focus();
      await nextTick();
      await nextTick();
      const tip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
      expect(tip).not.toBeNull();
      expect(wrapper.get('button').attributes('aria-describedby')).toBe(tip.id);
      expect(parseFloat(tip.style.left)).toBe(window.innerWidth - 170);
      await wrapper.get('button').trigger('keydown', { key: 'Escape' });
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
      expect(wrapper.get('button').attributes('aria-describedby')).toBeUndefined();
      wrapper.get('button').element.blur();
      wrapper.get('button').element.focus();
      await nextTick();
      window.dispatchEvent(new Event('resize'));
      await nextTick();
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
    } finally {
      wrapper.unmount();
    }
  });
});
