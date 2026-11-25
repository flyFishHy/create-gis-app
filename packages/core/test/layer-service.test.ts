import { describe, expect, it, vi } from 'vitest';
import { createGISApp } from '../src/gis-app.js';
import type { LayerConfig, MapLayerHandle } from '../src/types.js';
import { createFakeLayerDefinition, createFakeMapPlugin, FakeMapAdapter } from './fake-map.js';

describe('LayerService', () => {
  it('rejects stale references at selection and revalidates the active feature after filtering', async () => {
    let activeKey = 'before';
    const app = createGISApp().use(
      createFakeMapPlugin(undefined, {
        test: createFakeLayerDefinition(() => ({
          setVisible() {},
          setZIndex() {},
          dispose() {},
          canSelectFeature: (feature) => feature.featureKey === activeKey,
          supportsLegendFilter: () => true,
          setLegendFilter(ruleId) {
            activeKey = ruleId ?? 'before';
          },
        })),
      })
    );
    try {
      await app.init({ layers: [{ id: 'places', type: 'test' }] });
      const feature = { layerId: 'places', featureKey: 'before' };
      app.interactions.select({ feature });
      expect(app.interactions.getSelection()).toEqual(feature);
      app.layers.get('places')!.setLegendFilter('after');
      expect(app.interactions.getSelection()).toBeUndefined();
      app.interactions.select({ feature });
      expect(app.interactions.getSelection()).toBeUndefined();
    } finally {
      await app.dispose();
    }
  });

  it('uses one path for configured and dynamically added layers, and releases handles on remove', async () => {
    const adapter = new FakeMapAdapter();
    const handles = new Map<string, MapLayerHandle>();
    const makeLayer = (config: LayerConfig) => {
      const handle: MapLayerHandle = {
        setVisible: vi.fn(),
        setZIndex: vi.fn(),
        update: vi.fn(),
        dispose: vi.fn(),
      };
      handles.set(config.id, handle);
      return handle;
    };
    const app = createGISApp();
    app.use(createFakeMapPlugin(adapter, { raster: createFakeLayerDefinition(makeLayer) }));
    await app.init({
      map: { center: [1, 2], zoom: 3 },
      layers: [{ id: 'initial', type: 'raster', title: 'Initial' }],
    });

    const added = await app.layers.add({ id: 'dynamic', type: 'raster', visible: false });
    expect(app.layers.list().map((layer) => layer.id)).toEqual(['initial', 'dynamic']);
    expect(handles.get('dynamic')?.setVisible).toHaveBeenCalledWith(false);
    await app.layers.update('dynamic', { title: 'Updated', visible: true });
    expect(added.title).toBe('Updated');
    expect(added.visible).toBe(true);

    await app.layers.remove('dynamic');
    expect(handles.get('dynamic')?.dispose).toHaveBeenCalledOnce();
    expect(adapter.removed).toContain(handles.get('dynamic'));
    await app.dispose();
  });

  it('rejects duplicate ids and unknown types without corrupting current layers', async () => {
    const app = createGISApp();
    app.use(createFakeMapPlugin(new FakeMapAdapter(), { raster: createFakeLayerDefinition() }));
    await app.init({});
    await app.layers.add({ id: 'one', type: 'raster' });
    await expect(app.layers.add({ id: 'one', type: 'raster' })).rejects.toMatchObject({
      code: 'LAYER_DUPLICATE',
    });
    await expect(app.layers.add({ id: 'unknown', type: 'missing' })).rejects.toMatchObject({
      code: 'LAYER_TYPE_NOT_FOUND',
    });
    expect(app.layers.list().map((layer) => layer.id)).toEqual(['one']);
    await app.dispose();
  });

  it('exposes adapter-owned time dimensions and validates time filters', async () => {
    const setTimeFilter = vi.fn();
    const app = createGISApp();
    app.use(
      createFakeMapPlugin(new FakeMapAdapter(), {
        temporal: createFakeLayerDefinition(() => ({
          setVisible() {},
          setZIndex() {},
          dispose() {},
          setTimeFilter,
          getTimeDimensions: () => [
            { field: 'observed_at', values: [1_700_000_000_000, 1_800_000_000_000] },
          ],
          getTimeFilter: () => setTimeFilter.mock.lastCall?.[0],
        })),
      })
    );
    await app.init({ layers: [{ id: 'events', type: 'temporal' }] });
    const layer = app.layers.get('events')!;
    expect(layer.getTimeDimensions()[0]).toMatchObject({ field: 'observed_at' });
    layer.setTimeFilter({ field: 'observed_at', start: 1_700_000_000_000, end: 1_800_000_000_000 });
    expect(setTimeFilter).toHaveBeenLastCalledWith({
      field: 'observed_at',
      start: 1_700_000_000_000,
      end: 1_800_000_000_000,
    });
    expect(() => layer.setTimeFilter({ field: 'observed_at', start: 2, end: 1 })).toThrow(
      'invalid time filter'
    );
    await app.dispose();
  });

  it('manages groups recursively and applies visibility to child layers', async () => {
    const handles = new Map<string, MapLayerHandle>();
    const app = createGISApp();
    app.use(
      createFakeMapPlugin(new FakeMapAdapter(), {
        raster: createFakeLayerDefinition((config) => {
          const handle: MapLayerHandle = {
            setVisible: vi.fn(),
            setZIndex: vi.fn(),
            dispose: vi.fn(),
          };
          handles.set(config.id, handle);
          return handle;
        }),
      })
    );
    await app.init({
      layers: [
        {
          id: 'group',
          type: 'GROUP',
          title: 'Base maps',
          children: [
            { id: 'a', type: 'raster' },
            { id: 'b', type: 'raster' },
          ],
        },
      ],
    });
    expect(app.layers.get('group')?.getMetadata()).toMatchObject({ childIds: ['a', 'b'] });
    app.layers.setVisibility('group', false);
    expect(handles.get('a')?.setVisible).toHaveBeenCalledWith(false);
    expect(handles.get('b')?.setVisible).toHaveBeenCalledWith(false);
    let published: unknown;
    const unsubscribe = app.layers.subscribe((event) => {
      if (event.type === 'add' && event.id === 'c')
        published = app.layers.get('group')?.getMetadata().childIds;
    });
    await app.layers.addChild('group', { id: 'c', type: 'raster' });
    expect(published).toEqual(['a', 'b', 'c']);
    expect(handles.get('c')?.setVisible).toHaveBeenCalledWith(false);
    unsubscribe();
    await app.layers.remove('b');
    expect(app.layers.get('group')?.getMetadata().childIds).toEqual(['a', 'c']);
    await app.layers.remove('group');
    expect(app.layers.list()).toHaveLength(0);
    expect(handles.get('a')?.dispose).toHaveBeenCalledOnce();
    expect(handles.get('b')?.dispose).toHaveBeenCalledOnce();
    expect(handles.get('c')?.dispose).toHaveBeenCalledOnce();
    await app.dispose();
  });

  it('publishes a complete group tree once all children are ready and hides failed additions', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let waiting!: () => void;
    const started = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    const disposed = vi.fn();
    const app = createGISApp().use(
      createFakeMapPlugin(new FakeMapAdapter(), {
        staged: {
          async create(_context, config) {
            if (config.id === 'slow') {
              waiting();
              await gate;
            }
            return { setVisible() {}, setZIndex() {}, dispose: () => disposed(config.id) };
          },
        },
      })
    );
    await app.init({});
    const events: string[][] = [];
    const snapshots: string[][] = [];
    app.layers.subscribe(() => events.push(app.layers.list().map(({ id }) => id)));
    app.context.state.subscribe(({ layers }) => {
      if (layers.length) snapshots.push(layers.map(({ id }) => id));
    });
    try {
      const adding = app.layers.add({
        id: 'group',
        type: 'GROUP',
        children: [
          { id: 'fast', type: 'staged' },
          { id: 'slow', type: 'staged' },
        ],
      });
      await started;
      expect(app.layers.list()).toEqual([]);
      expect(events).toEqual([]);
      expect(snapshots).toEqual([]);
      await expect(app.layers.add({ id: 'fast', type: 'staged' })).rejects.toMatchObject({
        code: 'LAYER_DUPLICATE',
      });
      release();
      await adding;
      const complete = ['fast', 'slow', 'group'];
      expect(events).toEqual([complete, complete, complete]);
      expect(snapshots).toEqual([complete]);
      await expect(
        app.layers.add({
          id: 'failed',
          type: 'GROUP',
          children: [
            { id: 'temporary', type: 'staged' },
            { id: 'invalid', type: 'missing' },
          ],
        })
      ).rejects.toMatchObject({ code: 'LAYER_TYPE_NOT_FOUND' });
      expect(events).toHaveLength(3);
      expect(disposed).toHaveBeenCalledWith('temporary');
      await app.layers.add({ id: 'temporary', type: 'staged' });
    } finally {
      release();
      await app.dispose();
    }
  });
});
