import { expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { createGISApp, parseGISAppConfig } from '@joinmap/gis-core';
import { createOLAdapter } from '../../adapter-ol/src/index.js';
import { createVueUI, loadWorkspaceConfig } from '../../ui-vue/src/index.js';

const workspaceKey = 'test.workspace-workflow';
const config = parseGISAppConfig({
  ui: { layout: 'overlay-dashboard' },
  layers: [
    {
      id: 'sites',
      type: 'geojson',
      title: 'Sites',
      source: {
        type: 'inline',
        data: {
          type: 'FeatureCollection',
          features: [1, 2].map((value) => ({
            type: 'Feature',
            id: value,
            properties: {
              name: `Site ${value}`,
              kind: `kind-${value}`,
              observed_at: `2024-01-0${value}`,
            },
            geometry: { type: 'Point', coordinates: [value, value] },
          })),
        },
      },
      legend: {
        type: 'category',
        field: 'kind',
        items: [{ id: 'original', values: ['kind-1'], label: 'Original', color: '#111111' }],
      },
    },
  ],
});

it('preserves range, legend drafts and reset baseline while switching layouts and invalidates stale results', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  const app = createGISApp()
    .use(createOLAdapter())
    .use(createVueUI({ workspaceStorageKey: workspaceKey }));
  const target = document.createElement('div');
  document.body.append(target);
  const button = (label: string) =>
    target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  try {
    await app.init(config);
    const layer = app.layers.get('sites')!;
    const [start, end] = layer.getTimeDimensions()[0]!.values as readonly [number, number];
    layer.setTimeFilter({ field: 'observed_at', start, end });
    await app.mount(target);
    await nextTick();
    expect(layer.getTimeFilter()).toEqual({ field: 'observed_at', start, end });

    target.querySelector<HTMLButtonElement>('.gis-ui-legend-rule')!.click();
    await nextTick();
    expect(layer.getLegendFilter()).toBe('original');
    target.querySelector<HTMLButtonElement>('.gis-ui-legend-rule')!.click();

    const input = target.querySelector<HTMLInputElement>('.gis-ui-search-form input')!;
    input.value = 'site';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    target
      .querySelector('.gis-ui-search-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(target.querySelector('.gis-ui-search-results')?.textContent).toContain('Site 2');
    const picker = target.querySelector<HTMLButtonElement>('.gis-ui-time-picker-trigger')!;
    picker.click();
    await nextTick();
    const today = [
      ...target.querySelectorAll<HTMLButtonElement>('.gis-ui-time-picker-shortcuts button'),
    ].find((control) => control.textContent === '今天')!;
    today.click();
    await nextTick();
    target.querySelector<HTMLButtonElement>('.gis-ui-time-picker-apply')!.click();
    await nextTick();
    expect(layer.getTimeFilter()).toEqual({ field: 'observed_at', start, end });
    expect(app.context.state.snapshot().extensions['vue-ui']).toMatchObject({
      timeSelection: { mode: 'single', granularity: 'day' },
    });
    expect(picker.textContent).toMatch(/\d{4}-\d{2}-\d{2}/);
    layer.setTimeFilter({ field: 'observed_at', start, end: start });
    await nextTick();
    input.dispatchEvent(new FocusEvent('focus'));
    await nextTick();
    expect(target.querySelector('.gis-ui-search-results')).toBeNull();
    expect(await app.search.search({ keyword: 'site' })).toMatchObject([{ title: 'Site 1' }]);
    layer.setTimeFilter(undefined);
    await nextTick();

    const changedLegend = {
      ...config.layers![0]!.legend!,
      items: [{ id: 'edited', values: ['kind-2'], label: 'Changed', color: '#222222' }],
    };
    await app.layers.update('sites', { legend: changedLegend, options: { opacity: 0.55 } });
    await nextTick();
    target.querySelector<HTMLButtonElement>('.gis-ui-legend-edit')!.click();
    await nextTick();
    const draft = target.querySelector<HTMLInputElement>('input[name="itemLabel-0"]')!;
    draft.value = 'Unsaved label';
    draft.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    button('停靠').click();
    await nextTick();
    expect(target.querySelector('.gis-ui-layout--docked')).not.toBeNull();
    expect(target.querySelector('input[name="itemLabel-0"]')).toBe(draft);
    expect(target.querySelector('.gis-ui-time-picker-trigger')).toBe(picker);
    expect(draft.value).toBe('Unsaved label');
    expect(layer.getTimeFilter()).toBeUndefined();
    expect(loadWorkspaceConfig(workspaceKey, config)).toMatchObject({
      ui: { layout: 'docked-dashboard' },
      layers: [
        {
          legend: { items: [{ label: 'Changed' }] },
          options: { opacity: 0.55 },
        },
      ],
    });
    target
      .querySelector<HTMLButtonElement>('.gis-ui-layer-editor button[aria-label="关闭"]')!
      .click();
    await nextTick();
    button('重置 Sites').click();
    await flushPromises();
    expect(layer.legend?.items?.[0]?.label).toBe('Original');
    target.querySelector<HTMLButtonElement>('.gis-ui-legend-edit')!.click();
    await nextTick();
    const generate = [
      ...target.querySelectorAll<HTMLButtonElement>('.gis-ui-legend-editor button'),
    ].find((control) => control.textContent?.trim() === '自动生成')!;
    generate.click();
    await nextTick();
    expect(target.querySelectorAll('input[name^="itemLabel-"]')).toHaveLength(2);
    expect(layer.legend?.items).toHaveLength(1);
    target
      .querySelector('.gis-ui-legend-editor')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(layer.legend?.items?.map((item) => item.values)).toEqual([['kind-1'], ['kind-2']]);
  } finally {
    await app.dispose();
    target.remove();
    localStorage.removeItem(workspaceKey);
    vi.unstubAllGlobals();
  }
});
