import { expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ScrollArea from '../src/components/ScrollArea.vue';

it('sizes custom scrollbars from native overflow and supports dragging, track clicks, keyboard and cleanup', async () => {
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect = disconnect;
    }
  );
  const wrapper = mount(ScrollArea, {
    attachTo: document.body,
    props: { label: 'Details' },
    slots: { default: '<p>Content</p>' },
  });
  const root = wrapper.element as HTMLElement;
  const view = wrapper.get('.gis-ui-scroll-viewport').element as HTMLElement;
  const area = wrapper.vm as unknown as { refresh(): void };
  let height = 100,
    width = 120;
  Object.defineProperties(root, {
    clientHeight: { get: () => 100 },
    clientWidth: { get: () => 120 },
  });
  Object.defineProperties(view, {
    clientHeight: { get: () => 100 },
    clientWidth: { get: () => 120 },
    scrollHeight: { get: () => height },
    scrollWidth: { get: () => width },
  });
  function pointer(type: string, y: number) {
    return Object.assign(
      new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY: y }),
      { pointerId: 1 }
    );
  }
  try {
    area.refresh();
    await nextTick();
    expect(wrapper.find('[role="scrollbar"]').exists()).toBe(false);
    height = 500;
    area.refresh();
    await nextTick();
    const thumb = wrapper.get('[role="scrollbar"]');
    expect(thumb.attributes('aria-valuemax')).toBe('400');
    expect(thumb.attributes('aria-controls')).toBe(view.id);
    await thumb.trigger('keydown', { key: 'End' });
    expect(view.scrollTop).toBe(400);
    await thumb.trigger('keydown', { key: 'Home' });
    expect(view.scrollTop).toBe(0);
    wrapper.get('[aria-orientation="vertical"]').element.dispatchEvent(pointer('pointerdown', 0));
    document.dispatchEvent(pointer('pointermove', 34));
    await nextTick();
    expect(view.scrollTop).toBeCloseTo(200);
    document.dispatchEvent(pointer('pointerup', 34));
    await nextTick();
    expect(root.classList.contains('is-scrolling')).toBe(false);
    wrapper.get('.gis-ui-scroll-track').element.dispatchEvent(pointer('pointerdown', 90));
    await nextTick();
    expect(view.scrollTop).toBe(400);
    view.scrollTop = 80;
    await wrapper.get('.gis-ui-scroll-viewport').trigger('scroll');
    expect(thumb.attributes('aria-valuenow')).toBe('80');
    height = 100;
    wrapper.get('.gis-ui-scroll-content').element.append(document.createElement('span'));
    await Promise.resolve();
    await nextTick();
    expect(wrapper.find('[aria-orientation="vertical"]').exists()).toBe(false);
    height = 500;
    area.refresh();
    await nextTick();
    width = 360;
    area.refresh();
    await nextTick();
    expect(wrapper.findAll('[role="scrollbar"]')).toHaveLength(2);
    await wrapper.get('[aria-orientation="horizontal"]').trigger('keydown', { key: 'End' });
    expect(view.scrollLeft).toBe(240);
    wrapper.get('[aria-orientation="vertical"]').element.dispatchEvent(pointer('pointerdown', 0));
    wrapper.unmount();
    document.dispatchEvent(pointer('pointermove', 100));
    expect(view.scrollTop).toBe(80);
    expect(disconnect).toHaveBeenCalledOnce();
  } finally {
    if (wrapper.exists()) wrapper.unmount();
    vi.unstubAllGlobals();
  }
});
