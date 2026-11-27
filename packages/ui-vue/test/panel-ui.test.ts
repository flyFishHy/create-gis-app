import { describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, onUnmounted, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { createGISApp } from '@joinmap/gis-core';
import { createVueUI } from '../src/vue-ui.js';
import { PanelRegistry } from '../src/panels/panel-registry.js';
import PanelShell from '../src/components/PanelShell.vue';
import { usePanelHeader, type GISUIContext } from '@joinmap/ui-vue';

const Content = defineComponent({ render: () => h('p', 'Panel content') });

describe('Vue panel system', () => {
  it('applies config overrides and supports registration cleanup and panel state changes', () => {
    const registry = new PanelRegistry([
      { id: 'summary', visible: true, position: 'right', order: 7 },
    ]);
    const unregister = registry.register({
      id: 'summary',
      title: 'Summary',
      component: Content,
      defaultVisible: false,
    });
    expect(registry.getState('summary')).toMatchObject({
      visible: true,
      position: 'right',
      order: 7,
    });
    registry.collapse('summary');
    expect(registry.getState('summary')?.collapsed).toBe(true);
    registry.expand('summary');
    registry.hide('summary');
    expect(registry.getState('summary')?.visible).toBe(false);
    unregister();
    unregister();
    expect(registry.get('summary')).toBeUndefined();
    expect(registry.getState('summary')).toBeUndefined();
  });

  it('rejects duplicate panel ids and invalid ordering requests', () => {
    const registry = new PanelRegistry();
    registry.register({ id: 'one', title: 'One', component: Content });
    registry.register({ id: 'two', title: 'Two', component: Content });
    expect(() => registry.register({ id: 'one', title: 'Duplicate', component: Content })).toThrow(
      /already registered/
    );
    expect(() => registry.setOrder(['one', 'one'])).toThrow(/more than once/);
    expect(() => registry.setOrder(['missing'])).toThrow(/not registered/);
  });

  it('appends omitted panels in their existing order and confines an explicit order to its region', () => {
    const registry = new PanelRegistry();
    registry.register({ id: 'a', component: Content, position: 'left', order: 8 });
    registry.register({ id: 'b', component: Content, position: 'left', order: 1 });
    registry.register({ id: 'c', component: Content, position: 'left', order: 2 });
    registry.register({ id: 'right', component: Content, position: 'right', order: 0 });
    registry.setOrder(['a'], 'left');
    expect(registry.list('left').map(({ id }) => id)).toEqual(['a', 'b', 'c']);
    expect(['a', 'b', 'c'].map((id) => registry.getState(id)?.order)).toEqual([0, 1, 2]);
    expect(registry.getState('right')?.order).toBe(0);
    registry.setOrder(['c']);
    expect(registry.list().map(({ id }) => id)).toEqual(['c', 'a', 'right', 'b']);
  });

  it('falls back to an allowed position and ignores a stale registration cleanup', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = new PanelRegistry([{ id: 'test', position: 'left' }]);
    const stale = registry.register({
      id: 'test',
      component: Content,
      position: 'right',
      allowedPositions: ['bottom', 'right'],
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(registry.getState('test')?.position).toBe('right');
    registry.clear();
    registry.register({ id: 'test', component: Content });
    stale();
    expect(registry.getState('test')?.position).toBe('left');
  });

  it('renders an extension header and retains an opted-in body through collapse and hide', async () => {
    const disposed = vi.fn();
    const count = ref(1);
    const component = defineComponent({
      setup() {
        usePanelHeader(
          computed(() => String(count.value)),
          () => count.value++
        );
        onUnmounted(disposed);
        return () => h('p', 'Extension body');
      },
    });
    let ui: GISUIContext | undefined;
    const app = createGISApp().use(
      createVueUI({
        config: { locale: 'en' },
        extensions: [
          {
            name: 'summary',
            install(context) {
              ui = context;
              return context.panels.register({
                id: 'summary',
                component,
                title: 'Summary',
                icon: 'layers',
                header: { badgeLabel: 'Items counted', refreshLabel: 'Refresh summary' },
                keepMounted: true,
                defaultVisible: true,
              });
            },
          },
        ],
      })
    );
    const target = document.createElement('div');
    try {
      await app.init({});
      await app.mount(target);
      const panel = target.querySelector<HTMLElement>('.gis-ui-panel-host--summary')!;
      expect(panel.querySelector('.gis-ui-panel-title svg')).toBeTruthy();
      expect(panel.querySelector('[aria-label="Items counted"]')?.textContent).toBe('1');
      panel.querySelector<HTMLButtonElement>('[aria-label="Refresh summary"]')!.click();
      await nextTick();
      expect(panel.querySelector('[aria-label="Items counted"]')?.textContent).toBe('2');
      panel.querySelector<HTMLButtonElement>('[aria-expanded]')!.click();
      await nextTick();
      expect(panel.querySelector<HTMLElement>('.gis-ui-panel-body')?.style.display).toBe('none');
      panel.querySelector<HTMLButtonElement>('[aria-label="Close panel"]')!.click();
      await nextTick();
      expect(panel.style.display).toBe('none');
      ui!.panels.show('summary');
      ui!.panels.expand('summary');
      await nextTick();
      expect(panel.style.display).toBe('');
      expect(panel.querySelector<HTMLElement>('.gis-ui-panel-body')?.style.display).toBe('');
      expect(panel.querySelector('[aria-label="Items counted"]')?.textContent).toBe('2');
      expect(disposed).not.toHaveBeenCalled();
    } finally {
      await app.dispose();
    }
    expect(disposed).toHaveBeenCalledOnce();
  });

  it('renders PanelShell actions and hides content while collapsed', async () => {
    const wrapper = mount(PanelShell, {
      props: { title: 'Legend', collapsed: false, collapsible: true, closable: true },
      slots: { default: '<p>Legend rows</p>' },
    });
    expect(wrapper.text()).toContain('Legend rows');
    await wrapper.get('button[aria-expanded]').trigger('click');
    expect(wrapper.emitted('collapse')).toHaveLength(1);
    await wrapper.get('button[aria-label="Close panel"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
    await wrapper.setProps({ collapsed: true });
    expect(wrapper.text()).not.toContain('Legend rows');
  });

  it('mounts, unmounts, and remounts the official Vue UI with the runtime', async () => {
    const app = createGISApp();
    const extensionCleanup = vi.fn();
    app.use(
      createVueUI({
        extensions: [
          {
            name: 'test-extension',
            install: (ui) => {
              const unregister = ui.panels.register({
                id: 'test-panel',
                title: 'Test',
                component: Content,
                defaultVisible: true,
              });
              return () => {
                unregister();
                extensionCleanup();
              };
            },
          },
        ],
      })
    );
    await app.init({ ui: { layout: 'docked-dashboard' } });

    const firstTarget = document.createElement('div');
    document.body.append(firstTarget);
    await app.mount(firstTarget);
    expect(firstTarget.querySelector('.gis-ui-layout--docked')).not.toBeNull();
    expect(firstTarget.textContent).toContain('Test');

    await app.unmount();
    expect(firstTarget.innerHTML).toBe('');
    const secondTarget = document.createElement('div');
    document.body.append(secondTarget);
    await app.mount(secondTarget);
    expect(secondTarget.querySelector('.gis-ui-layout--docked')).not.toBeNull();
    await app.dispose();
    expect(extensionCleanup).toHaveBeenCalledOnce();
    expect(secondTarget.innerHTML).toBe('');
  });
});
