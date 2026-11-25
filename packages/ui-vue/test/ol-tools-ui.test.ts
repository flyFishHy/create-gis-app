import { afterEach, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { createGISApp } from '../../core/src/index.js';
import { createOLAdapter, useOLTools } from '../../adapter-ol/src/index.js';
import { createVueUI } from '../src/vue-ui.js';
import { createOLResultsUI } from '../../ol-vue/src/index.js';

afterEach(() => vi.unstubAllGlobals());
it('connects the generic toolbar to Core, preserves results on remount and deletes a selected result', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  const app = createGISApp();
  app.use(createOLAdapter({ controls: false, interactions: false }));
  app.use(createVueUI({ extensions: [createOLResultsUI()] }));
  const target = document.createElement('div');
  document.body.append(target);
  await app.init({ map: { center: [0, 0], zoom: 2 } });
  try {
    await app.mount(target);
    expect(
      target.querySelector<HTMLButtonElement>('button[aria-label="删除选中结果"]')!.disabled
    ).toBe(true);
    target.querySelector<HTMLButtonElement>('button[aria-label="绘制点"]')!.click();
    await flushPromises();
    expect(app.interactions.getActiveTool()).toBe('draw-point');
    await useOLTools(app).importResults([
      {
        id: 'sketch-1',
        toolId: 'draw-point',
        projection: 'EPSG:3857',
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
    ]);
    await nextTick();
    expect(target.querySelector('.gis-tool-results')!.textContent).toContain('sketch-1');
    await app.unmount();
    await app.mount(target);
    expect(target.querySelector('.gis-tool-results')!.textContent).toContain('sketch-1');
    target.querySelector<HTMLButtonElement>('.gis-tool-results button')!.click();
    await nextTick();
    expect(useOLTools(app).selected()).toBe('sketch-1');
    expect(target.querySelector('.gis-ui-panel-host--properties')!.textContent).toContain(
      'sketch-1'
    );
    expect(
      target.querySelector<HTMLButtonElement>('button[aria-label="删除选中结果"]')!.disabled
    ).toBe(false);
    target.querySelector<HTMLButtonElement>('button[aria-label="删除选中结果"]')!.click();
    await flushPromises();
    expect(useOLTools(app).list()).toHaveLength(0);
    expect(app.interactions.getSelection()).toBeUndefined();
    expect(target.querySelector('.gis-ui-panel-host--properties')).not.toBeNull();
    target.querySelector<HTMLButtonElement>('button[aria-label="English"]')!.click();
    await nextTick();
    expect(target.querySelector('button[aria-label="Draw point"]')).not.toBeNull();
    expect(
      target.querySelector<HTMLButtonElement>('button[aria-label="Delete selected result"]')!
        .disabled
    ).toBe(true);
  } finally {
    await app.dispose();
    target.remove();
  }
});
