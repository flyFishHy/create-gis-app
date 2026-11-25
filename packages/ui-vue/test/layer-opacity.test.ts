import { expect, it } from 'vitest';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { createGISApp } from '@joinmap/gis-core';
import { createFakeLayerDefinition, createFakeMapPlugin } from '../../core/test/fake-map.js';
import { createVueUI } from '../src/vue-ui.js';

it('coalesces rapid slider input while an adapter update is pending and reflects the last committed value', async () => {
  const app = createGISApp(),
    updates: number[] = [];
  let opacity = 1,
    release!: () => void;
  app.use(
    createFakeMapPlugin(undefined, {
      slow: createFakeLayerDefinition(() => ({
        setVisible() {},
        setZIndex() {},
        dispose() {},
        getMetadata: () => ({ opacity }),
        async update(patch) {
          const value = patch.options!.opacity as number;
          updates.push(value);
          if (updates.length === 1)
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          opacity = value;
        },
      })),
    })
  );
  app.use(createVueUI());
  const target = document.createElement('div');
  document.body.append(target);
  try {
    await app.init({ layers: [{ id: 'one', type: 'slow', title: 'One' }] });
    await app.mount(target);
    target.querySelector<HTMLButtonElement>('button[aria-label="图层配置 One"]')!.click();
    await nextTick();
    const slider = target.querySelector<HTMLInputElement>('.gis-ui-layer-opacity input')!;
    const input = (value: string) => {
      slider.value = value;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    };
    input('90');
    await flushPromises();
    expect(updates).toEqual([0.9]);
    input('50');
    input('20');
    await nextTick();
    expect(slider.value).toBe('20');
    expect(target.querySelector('.gis-ui-layer-opacity output')!.textContent).toBe('20%');
    release();
    await flushPromises();
    expect(updates).toEqual([0.9, 0.2]);
    expect(app.layers.get('one')!.getMetadata().opacity).toBe(0.2);
    expect(slider.value).toBe('20');
  } finally {
    release?.();
    await app.dispose();
    target.remove();
  }
});
