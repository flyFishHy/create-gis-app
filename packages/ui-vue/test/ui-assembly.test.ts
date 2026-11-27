import { createGISApp } from '@joinmap/gis-core';
import { mount } from '@vue/test-utils';
import { expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import TimeFilterPicker from '../src/components/time-picker/TimeFilterPicker.vue';
import GISWorkspace from '../src/GISWorkspace.vue';
import type { GISUIContext } from '../src/types.js';
import { createVueUI } from '../src/vue-ui.js';

it('uses explicit plugin options and saves committed preferences under their storage key', async () => {
  const key = 'ui-assembly-test';
  const fallback = vi.fn();
  let ui: GISUIContext | undefined;
  const app = createGISApp().use(
    createVueUI({ extensions: [{ name: 'fallback', install: fallback }] }),
    {
      config: { locale: 'en' },
      workspaceStorageKey: key,
      extensions: [
        {
          name: 'capture-theme',
          install: (context) => {
            ui = context;
          },
        },
      ],
    }
  );
  const target = document.createElement('div');
  try {
    await app.init({});
    expect(fallback).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBeNull();
    await app.mount(target);
    expect(localStorage.getItem(key)).toBeNull();
    vi.useFakeTimers();
    ui!.panels.hide('legend');
    vi.advanceTimersByTime(300);
    expect(localStorage.getItem(key)).toBeNull();
    ui!.theme.set({ mode: 'dark' });
    vi.advanceTimersByTime(200);
    ui!.locale.set('zh');
    vi.advanceTimersByTime(249);
    expect(localStorage.getItem(key)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
      ui: { locale: 'zh', theme: { mode: 'dark' } },
    });
    ui!.locale.set('en');
    await app.unmount();
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
      ui: { locale: 'en' },
    });
    ui!.theme.set({ mode: 'light' });
    await app.dispose();
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
      ui: { theme: { mode: 'light' } },
    });
  } finally {
    await app.dispose();
    vi.useRealTimers();
    localStorage.removeItem(key);
  }
});

it('keeps committed time and UI settings local to each app across unmount and remount', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 21, 10));
  const first = createGISApp().use(
    createVueUI({ config: { timePicker: { defaultTimeZone: 'UTC' } } })
  );
  const second = createGISApp().use(createVueUI({ config: { theme: 'dark' } }));
  await Promise.all([first.init({}), second.init({})]);
  const workspace = mount(GISWorkspace, { props: { app: first }, attachTo: document.body });
  const readUI = (app: typeof first) => app.context.state.snapshot().extensions['vue-ui'];
  try {
    await vi.waitFor(() => expect(first.status).toBe('mounted'));
    const picker = workspace.getComponent(TimeFilterPicker);
    await picker.get('.gis-ui-time-picker-trigger').trigger('click');
    await picker
      .findAll('button')
      .find((button) => button.text() === '本周')!
      .trigger('click');
    expect(readUI(first)).toMatchObject({ timeSelection: null });
    await picker.get('form').trigger('submit');
    const selected = {
      granularity: 'week',
      timeZone: 'UTC',
      range: { start: Date.UTC(2026, 10, 16), endExclusive: Date.UTC(2026, 10, 23) },
    };
    expect(readUI(first)).toMatchObject({ theme: { mode: 'light' }, timeSelection: selected });
    expect(readUI(second)).toMatchObject({ theme: { mode: 'dark' }, timeSelection: null });
    const target = workspace.element;
    await first.unmount();
    expect(workspace.findComponent(TimeFilterPicker).exists()).toBe(false);
    await first.mount(target);
    await nextTick();
    expect(workspace.getComponent(TimeFilterPicker).props('modelValue')).toMatchObject(selected);
  } finally {
    await Promise.all([first.dispose(), second.dispose()]);
    workspace.unmount();
  }
});
