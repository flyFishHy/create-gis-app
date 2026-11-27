import { expect, it, vi } from 'vitest';
import { defineComponent, h, inject, provide, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createGISApp } from '@joinmap/gis-core';
import { createFakeMapPlugin, FakeMapAdapter } from '../../core/test/fake-map.js';
import { getVueUIAdapter } from '../src/adapter/vue-ui-adapter.js';
import { createVueUI } from '../src/vue-ui.js';
import GISWorkspace from '../src/GISWorkspace.vue';
import type { GISUIContext } from '../src/types.js';

it('rolls back initialized UI extensions and pre-init search registrations after install failure', async () => {
  const app = createGISApp(),
    cleanup = vi.fn();
  app.search.registerProvider({ id: 'before-init', search: async () => [] });
  app.use(
    createVueUI({
      extensions: [
        { name: 'first', install: () => cleanup },
        {
          name: 'failing',
          install: () => {
            throw new Error('Install failed');
          },
        },
      ],
    })
  );
  await expect(app.init({})).rejects.toThrow();
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(app.search.listProviders()).toEqual([]);
  await app.dispose();
  expect(cleanup).toHaveBeenCalledTimes(1);
});

it('continues rollback in reverse order when an extension cleanup throws', async () => {
  const app = createGISApp();
  const order: string[] = [];
  let context: GISUIContext | undefined;
  app.use(
    createVueUI({
      extensions: [
        {
          name: 'first',
          install(ui) {
            context = ui;
            const unregister = ui.panels.register({ id: 'custom', component: {} });
            return () => {
              order.push('first');
              unregister();
            };
          },
        },
        {
          name: 'second',
          install: () => () => {
            order.push('second');
            throw new Error('Cleanup failed');
          },
        },
        {
          name: 'failing',
          install() {
            throw new Error('Install failed');
          },
        },
      ],
    })
  );
  await expect(app.init({})).rejects.toMatchObject({
    cause: expect.objectContaining({ message: 'Install failed' }),
    cleanupErrors: [expect.any(Error)],
  });
  expect(() => getVueUIAdapter(app)).toThrow(/Initialize createVueUI/);
  expect(context?.panels.list()).toEqual([]);
  expect(context?.toolbar.list()).toEqual([]);
  await app.dispose();
  expect(order).toEqual(['second', 'first']);
});

it('rejects competing hosts and retries mount with the owning host after a target error', async () => {
  const app = createGISApp().use(createVueUI());
  await app.init({});
  const adapter = getVueUIAdapter(app);
  const target = document.createElement('div');
  const render = vi.fn();
  const release = adapter.bindHost(render, () => target);
  try {
    expect(() => adapter.bindHost(vi.fn(), () => target)).toThrow(/already owns/);
    await expect(app.mount(document.createElement('div'))).rejects.toThrow(/host target/);
    expect(render).not.toHaveBeenCalled();
    await app.mount(target);
    expect(render).toHaveBeenCalledExactlyOnceWith(true);
    await app.unmount();
    expect(render.mock.calls).toEqual([[true], [false]]);
  } finally {
    await app.dispose();
    release();
  }
});

it('releases ownership when the host disappears before its queued mount starts', async () => {
  const app = createGISApp(),
    map = new FakeMapAdapter();
  app.use(createFakeMapPlugin(map));
  app.use(createVueUI());
  await app.init({ map: { center: [0, 0], zoom: 2 } });
  const wrapper = mount(GISWorkspace, { props: { app }, attachTo: document.body });
  wrapper.unmount();
  await flushPromises();
  expect(app.status).toBe('ready');
  expect(map.target).toBeUndefined();
  const again = mount(GISWorkspace, { props: { app }, attachTo: document.body });
  await flushPromises();
  expect(app.status).toBe('mounted');
  again.unmount();
  await flushPromises();
  await app.dispose();
});

it('embeds in the host Vue tree, merges defaults once and shares Runtime mount/unmount ownership', async () => {
  const app = createGISApp(),
    map = new FakeMapAdapter();
  let ui!: GISUIContext;
  app.use(createFakeMapPlugin(map));
  app.use(
    createVueUI({
      config: {
        layout: 'overlay-dashboard',
        theme: { mode: 'dark', tokens: { panelWidth: '280px' } },
        panels: [{ id: 'legend', visible: false, order: 9 }],
      },
      panelDefinitions: [
        {
          id: 'host-content',
          defaultVisible: true,
          component: defineComponent({ setup: () => () => h('p', String(inject('host-message'))) }),
        },
      ],
      extensions: [
        {
          name: 'capture',
          install(context) {
            ui = context;
          },
        },
      ],
    })
  );
  await app.init({
    map: { center: [0, 0], zoom: 2 },
    ui: {
      layout: 'docked-dashboard',
      theme: { mode: 'light' },
      panels: [{ id: 'legend', visible: true }],
    },
  });
  const Host = defineComponent({
    setup() {
      provide('host-message', 'Inherited host context');
      return () => h(GISWorkspace, { app });
    },
  });
  const wrapper = mount(Host, { attachTo: document.body });
  try {
    await flushPromises();
    expect(app.status).toBe('mounted');
    expect(wrapper.findAll('.gis-ui-root')).toHaveLength(1);
    expect(wrapper.find('.gis-ui-layout--docked').exists()).toBe(true);
    expect(wrapper.text()).toContain('Inherited host context');
    expect(ui.theme.get()).toMatchObject({ mode: 'light', tokens: { panelWidth: '280px' } });
    expect(ui.panels.getState('legend')).toMatchObject({
      visible: true,
      order: 9,
      position: 'left',
    });
    ui.panels.hide('legend');
    ui.theme.set({ mode: 'dark' });
    await nextTick();
    expect(wrapper.find('.gis-ui-panel-host--legend').exists()).toBe(false);
    expect(wrapper.find('.gis-ui-theme-dark').exists()).toBe(true);
    await expect(app.mount(document.createElement('div'))).rejects.toThrow();
    wrapper.unmount();
    await flushPromises();
    expect(app.status).toBe('unmounted');
    expect(map.target).toBeUndefined();
    const again = mount(Host, { attachTo: document.body });
    await flushPromises();
    expect(app.status).toBe('mounted');
    expect(again.find('.gis-ui-panel-host--legend').exists()).toBe(false);
    await app.dispose();
    await nextTick();
    expect(again.find('.gis-ui-root').exists()).toBe(false);
    again.unmount();
  } finally {
    if (app.status !== 'disposed') await app.dispose();
    if (wrapper.exists()) wrapper.unmount();
  }
});
