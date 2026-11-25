import { expect, it, vi } from 'vitest';
import { createGISApp } from '../src/index.js';
import type { MapLocation } from '../src/types.js';
import { createFakeLayerDefinition, createFakeMapPlugin } from './fake-map.js';

it('reads current locations, ignores invalid coverage and merges live group members without stale IDs', async () => {
  const locations = new Map<string, MapLocation>([
    ['a', { coordinate: [1, 2], projection: 'EPSG:4326' }],
    ['b', { extent: [3, 4, 5, 6], projection: 'EPSG:4326' }],
  ]);
  const z = new Map<string, ReturnType<typeof vi.fn>>();
  const app = createGISApp();
  app.use(
    createFakeMapPlugin(undefined, {
      test: createFakeLayerDefinition((config) => {
        const setZIndex = vi.fn();
        z.set(config.id, setZIndex);
        return {
          setVisible() {},
          setZIndex,
          dispose() {},
          getDataLocation: () => locations.get(config.id),
        };
      }),
    })
  );
  try {
    await app.init({
      map: { projection: 'EPSG:4326' },
      layers: [
        {
          id: 'group',
          type: 'GROUP',
          children: [
            { id: 'a', type: 'test' },
            { id: 'b', type: 'test' },
          ],
        },
      ],
    });
    expect(app.layers.getDataLocation('group')).toEqual({
      extent: [1, 2, 5, 6],
      projection: 'EPSG:4326',
    });
    app.layers.setVisibility('a', false);
    expect(app.layers.getDataLocation('a')?.coordinate).toEqual([1, 2]);
    locations.set('a', { extent: [7, 8, 7, 8], projection: 'EPSG:4326' });
    expect(app.layers.getDataLocation('a')?.coordinate).toEqual([7, 8]);
    locations.set('b', { extent: [Infinity, Infinity, -Infinity, -Infinity] });
    expect(app.layers.getDataLocation('b')).toBeUndefined();
    expect(app.layers.getDataLocation('group')?.coordinate).toEqual([7, 8]);
    await app.layers.remove('a');
    await app.layers.add({ id: 'a', type: 'test' });
    expect(app.layers.getDataLocation('group')).toBeUndefined();
    app.layers.setOrder(['b', 'group', 'a']);
    expect(z.get('b')).toHaveBeenLastCalledWith(0);
    expect(z.get('a')).toHaveBeenLastCalledWith(1);
    expect(() => app.layers.getDataLocation('missing')).toThrow();
  } finally {
    await app.dispose();
  }
});
