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
  app.use({
    name: 'overflow-draw-tool',
    install(runtime, _options, scope) {
      runtime.registerTool('draw-line', { id: 'draw-line', activate() {} }, scope);
    },
  });
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
    more.click();
    await nextTick();
    const tool = Array.from(target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
      (item) => item.textContent?.includes('绘制线')
    )!;
    tool.focus();
    tool.click();
    await vi.waitFor(() => expect(app.interactions.getActiveTool()).toBe('draw-line'));
    expect(document.activeElement).toBe(more);
    more.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect(app.interactions.getActiveTool()).toBeUndefined());
    expect(document.activeElement).not.toBe(more);
  } finally {
    await app.dispose();
    target.remove();
    width.mockRestore();
    rect.mockRestore();
  }
});

it.each([undefined, 2])(
  'fits the vertical toolbar to the overlay height with a configured limit of %s',
  async (toolbarMaxVisibleTools) => {
    let height = 105;
    let resizeToolbar: (() => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: ResizeObserverCallback) {}
        observe(target: Element) {
          if (target.classList.contains('gis-ui-overlay--toolbar')) {
            resizeToolbar = () =>
              this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
          }
        }
        disconnect() {}
      }
    );
    const clientHeight = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('gis-ui-overlay--toolbar') ? height : 50;
      });
    const box = (left: number, top: number, width: number, height: number) =>
      ({ left, right: left + width, top, bottom: top + height, width, height }) as DOMRect;
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains('gis-ui-toolbar-measure')) {
          return box(0, 0, 48, 220);
        }
        if (this.classList.contains('gis-ui-toolbar-measure-item')) {
          const entries = Array.from(
            this.closest('.gis-ui-toolbar-measure')!.querySelectorAll(
              '.gis-ui-toolbar-measure-item'
            )
          );
          return box(6, [6, 45, 95, 134][entries.indexOf(this)]!, 36, 36);
        }
        if (this.parentElement?.classList.contains('gis-ui-toolbar-measure')) {
          return box(6, 177, 36, 36);
        }
        if (this.classList.contains('gis-ui-toolbar-more')) {
          return box(700, window.innerHeight - 54, 36, 36);
        }
        if (this.classList.contains('gis-ui-toolbar-menu')) {
          return box(0, 0, 160, 180);
        }
        return box(0, 0, 0, 0);
      });
    const action = vi.fn();
    const app = createGISApp()
      .use(createFakeMapPlugin())
      .use(
        createVueUI({
          toolbarMaxVisibleTools,
          toolbarItems: [
            { id: 'custom', title: 'Custom action', order: 100, onClick: action },
            { id: 'readout', title: 'Scale', order: 101, display: () => '1:2000' },
          ],
        })
      );
    const target = document.createElement('div');
    document.body.append(target);
    try {
      await app.init({ ui: { layout: 'overlay-dashboard' } });
      await app.mount(target);
      const slot = target.querySelector<HTMLElement>('.gis-ui-overlay--toolbar')!;
      const direct = () =>
        [...slot.querySelectorAll('.gis-ui-toolbar .gis-ui-toolbar-group [aria-label]')].map(
          (item) => item.getAttribute('aria-label')
        );
      const getMenu = () => target.querySelector<HTMLElement>('.gis-ui-toolbar-menu')!;
      await vi.waitFor(() => expect(direct()).toEqual(['放大']));
      const more = slot.querySelector<HTMLButtonElement>('.gis-ui-toolbar-more')!;
      expect(more.querySelector('.gis-ui-toolbar-more-label')).toBeNull();
      more.click();
      await vi.waitFor(() => {
        expect(getMenu().style.left).toBe('536px');
        expect(document.activeElement).toBe(getMenu().querySelector('button'));
      });
      expect(getMenu().style.top).toBe(`${window.innerHeight - 188}px`);
      expect(
        [...getMenu().querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)
      ).toEqual(['缩小', 'Custom action', 'Scale1:2000']);
      getMenu().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await nextTick();
      expect(getMenu()).toBeNull();
      expect(document.activeElement).toBe(more);

      slot.style.setProperty('--gis-ui-toolbar-menu-side', 'right');
      more.click();
      await vi.waitFor(() => expect(getMenu().style.left).toBe('740px'));
      getMenu().querySelectorAll('button')[1]!.click();
      expect(action).toHaveBeenCalledOnce();
      height = 64;
      resizeToolbar!();
      await nextTick();
      expect(direct()).toEqual([]);
      expect(more.isConnected).toBe(true);

      height = 300;
      resizeToolbar!();
      await nextTick();
      expect(direct()).toEqual(
        toolbarMaxVisibleTools ? ['放大', '缩小'] : ['放大', '缩小', 'Custom action', 'Scale']
      );
      expect(more.isConnected).toBe(toolbarMaxVisibleTools !== undefined);
    } finally {
      await app.dispose();
      target.remove();
      rect.mockRestore();
      clientHeight.mockRestore();
      vi.unstubAllGlobals();
    }
  }
);
