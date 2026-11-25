import { expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createGISApp } from '@joinmap/gis-core';
import { createVueUI } from '../src/vue-ui.js';
import { createFakeMapPlugin } from '../../core/test/fake-map.js';

it('keeps the left rail and map mounted while properties close and reopen on selection', async () => {
  const app = createGISApp();
  app.use(createFakeMapPlugin());
  app.use(createVueUI());
  const target = document.createElement('div');
  document.body.append(target);
  try {
    await app.init({ ui: { layout: 'docked-dashboard' } });
    await app.mount(target);
    const left = target.querySelector('.gis-ui-left-region')!;
    const layers = left.querySelector('.gis-ui-panel-host--layer-manager');
    const legend = left.querySelector('.gis-ui-panel-host--legend');
    const map = target.querySelector('.gis-ui-map-viewport');
    expect(layers).not.toBeNull();
    expect(legend).not.toBeNull();
    expect(left.querySelector('.gis-ui-panel-close')).toBeNull();
    expect(target.querySelector('.gis-ui-sidebar-collapse, .gis-ui-sidebar-restore')).toBeNull();
    for (let index = 0; index < 3; index++) {
      app.interactions.select({ feature: { layerId: 'external', id: index } });
      await nextTick();
      const selected = app.interactions.getSelection();
      target.querySelector<HTMLButtonElement>('.gis-ui-right-region .gis-ui-panel-close')!.click();
      await nextTick();
      expect(target.querySelector('.gis-ui-panel-host--properties')).toBeNull();
      expect(target.querySelector('.gis-ui-workspace.is-right-hidden')).not.toBeNull();
      expect(app.interactions.getSelection()).toEqual(selected);
      expect(target.querySelector('.gis-ui-panel-host--layer-manager')).toBe(layers);
      expect(target.querySelector('.gis-ui-panel-host--legend')).toBe(legend);
      expect(target.querySelector('.gis-ui-map-viewport')).toBe(map);
    }
    app.interactions.select({ feature: { layerId: 'external', id: 'new' } });
    await nextTick();
    expect(target.querySelector('.gis-ui-panel-host--properties')).not.toBeNull();
    app.interactions.clearSelection();
    await nextTick();
    expect(target.querySelector('.gis-ui-panel-host--properties')!.textContent).toContain(
      '未选中空间要素'
    );
    expect(left.hasAttribute('inert')).toBe(false);
  } finally {
    await app.dispose();
    target.remove();
  }
});

it('keeps panels presented initially on narrow screens without sidebar restore controls', async () => {
  const width = Object.getOwnPropertyDescriptor(window, 'innerWidth')!;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 });
  const app = createGISApp();
  app.use(createFakeMapPlugin());
  app.use(createVueUI());
  const target = document.createElement('div');
  document.body.append(target);
  try {
    await app.init({ ui: { layout: 'docked-dashboard' } });
    await app.mount(target);
    expect(target.querySelector('.gis-ui-left-region')!.hasAttribute('inert')).toBe(false);
    expect(target.querySelector('.gis-ui-right-region')!.hasAttribute('inert')).toBe(false);
    expect(target.querySelector('.gis-ui-panel-host--properties')).not.toBeNull();
    expect(target.querySelector('.gis-ui-sidebar-collapse, .gis-ui-sidebar-restore')).toBeNull();
  } finally {
    await app.dispose();
    target.remove();
    Object.defineProperty(window, 'innerWidth', width);
  }
});

it('honors an explicit properties visible=false configuration', async () => {
  const app = createGISApp();
  app.use(createFakeMapPlugin());
  app.use(createVueUI());
  const target = document.createElement('div');
  document.body.append(target);
  try {
    await app.init({
      ui: { layout: 'docked-dashboard', panels: [{ id: 'properties', visible: false }] },
    });
    await app.mount(target);
    app.interactions.select({ feature: { layerId: 'external', id: 'one' } });
    await nextTick();
    expect(target.querySelector('.gis-ui-panel-host--properties')).toBeNull();
    expect(target.querySelector('.gis-ui-panel-host--layer-manager')).not.toBeNull();
  } finally {
    await app.dispose();
    target.remove();
  }
});

it('fits the toolbar when available space changes after closing properties', async () => {
  let available = 800,
    resizeToolbar: (() => void) | undefined;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        if (target.classList.contains('gis-ui-toolbar-root'))
          resizeToolbar = () =>
            this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    }
  );
  const width = vi
    .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
    .mockImplementation(() => available);
  const rect = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({ width: 70, left: 0, right: 70, top: 0, bottom: 32, height: 32 } as DOMRect);
  const app = createGISApp();
  app.use(createFakeMapPlugin());
  app.use(createVueUI());
  const target = document.createElement('div');
  document.body.append(target);
  try {
    await app.init({ ui: { layout: 'docked-dashboard' } });
    await app.mount(target);
    await nextTick();
    expect(target.querySelector('.gis-ui-toolbar .gis-ui-toolbar-more')).toBeNull();
    target.querySelector<HTMLButtonElement>('.gis-ui-right-region .gis-ui-panel-close')!.click();
    await nextTick();
    available = 80;
    resizeToolbar!();
    await nextTick();
    expect(target.querySelector('.gis-ui-toolbar .gis-ui-toolbar-more')).not.toBeNull();
  } finally {
    await app.dispose();
    target.remove();
    width.mockRestore();
    rect.mockRestore();
    vi.unstubAllGlobals();
  }
});

it('moves tools into a working overflow menu when space is limited', async () => {
  const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(80);
  const rect = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({ width: 70, left: 0, right: 70, top: 0, bottom: 32, height: 32 } as DOMRect);
  const action = vi.fn(),
    app = createGISApp();
  app.use(createFakeMapPlugin());
  app.use(
    createVueUI({ toolbarItems: [{ id: 'custom', title: 'Custom action', onClick: action }] })
  );
  const target = document.createElement('div');
  document.body.append(target);
  try {
    await app.init({ ui: { layout: 'docked-dashboard' } });
    await app.mount(target);
    await nextTick();
    const more = target.querySelector<HTMLButtonElement>('.gis-ui-toolbar .gis-ui-toolbar-more')!;
    expect(more.textContent).toContain('更多');
    expect(more.querySelectorAll('circle')).toHaveLength(3);
    more.click();
    await nextTick();
    const menu = target.querySelector('[role="menu"]')!;
    expect(menu).not.toBeNull();
    const button = Array.from(menu.querySelectorAll<HTMLButtonElement>('button')).find((e) =>
      e.textContent?.includes('Custom action')
    )!;
    button.click();
    await nextTick();
    expect(action).toHaveBeenCalledOnce();
    expect(target.querySelector('[role="menu"]')).toBeNull();
  } finally {
    await app.dispose();
    target.remove();
    width.mockRestore();
    rect.mockRestore();
  }
});
