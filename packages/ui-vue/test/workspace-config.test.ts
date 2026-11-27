import { createGISApp } from '@joinmap/gis-core';
import { expect, it } from 'vitest';
import { createFakeLayerDefinition, createFakeMapPlugin } from '../../core/test/fake-map.js';
import { captureWorkspaceConfig, loadWorkspaceConfig } from '../src/workspace-config.js';
import { createVueUI } from '../src/vue-ui.js';

const createApp = () =>
  createGISApp().use(createFakeMapPlugin(undefined, { test: createFakeLayerDefinition() }));

it('restores configured layer settings through nested gates and excludes runtime-only branches', async () => {
  const app = createApp().use(createVueUI());
  const restored = createApp();
  const key = 'ui-workspace-roundtrip';
  try {
    await app.init({
      layers: [
        {
          id: 'group',
          type: 'GROUP',
          visible: false,
          children: [
            {
              id: 'nested',
              type: 'GROUP',
              children: [
                { id: 'enabled', type: 'test' },
                { id: 'disabled', type: 'test', visible: false },
                { id: 'removed', type: 'test', source: 'configured-source' },
              ],
            },
          ],
        },
      ],
    });
    await app.layers.update('enabled', { title: 'Updated', zIndex: 27 });
    await app.layers.remove('removed');
    await app.layers.addChild('nested', { id: 'removed', type: 'test', source: 'runtime-source' });
    await app.layers.addChild('nested', { id: 'temporary', type: 'test' });

    const exported = captureWorkspaceConfig(app);
    expect(exported.layers).toEqual([
      {
        id: 'group',
        type: 'GROUP',
        visible: false,
        children: [
          {
            id: 'nested',
            type: 'GROUP',
            visible: true,
            children: [
              { id: 'enabled', type: 'test', title: 'Updated', visible: true, zIndex: 27 },
              { id: 'disabled', type: 'test', visible: false, zIndex: 0 },
            ],
          },
        ],
      },
    ]);
    localStorage.setItem(key, JSON.stringify(exported));
    await restored.init(loadWorkspaceConfig(key, {}));
    expect(restored.layers.get('enabled')).toMatchObject({
      ownVisible: true,
      visible: false,
      zIndex: 27,
    });
    restored.layers.setVisibility('group', true);
    expect(restored.layers.get('enabled')?.visible).toBe(true);
    expect(restored.layers.get('disabled')?.visible).toBe(false);
    expect(restored.layers.get('removed')).toBeUndefined();
    expect(restored.layers.get('temporary')).toBeUndefined();
  } finally {
    localStorage.removeItem(key);
    await Promise.all([app.dispose(), restored.dispose()]);
  }
});

it('uses application defaults when saved workspace JSON is invalid', () => {
  const key = 'ui-workspace-invalid';
  const fallback = { ui: { locale: 'en' } } as const;
  try {
    localStorage.setItem(key, '{');
    expect(loadWorkspaceConfig(key, fallback)).toBe(fallback);
  } finally {
    localStorage.removeItem(key);
  }
});
