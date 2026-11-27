import { describe, expect, it, vi } from 'vitest';
import { createGISApp } from '../src/index.js';
import type { LayerConfig, MapLayerHandle } from '../src/types.js';
import { createFakeLayerDefinition, createFakeMapPlugin, FakeMapAdapter } from './fake-map.js';

describe('LayerService', () => {
  it('reserves later descendants before the first factory starts', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = createGISApp().use(
      createFakeMapPlugin(undefined, {
        test: {
          async create(_context, { id }) {
            if (id === 'first') {
              await gate;
            }
            return { setVisible() {}, setZIndex() {}, dispose() {} };
          },
        },
      })
    );
    await app.init({});
    try {
      const pending = app.layers.add({
        id: 'group',
        type: 'GROUP',
        children: [
          { id: 'first', type: 'test' },
          { id: 'later', type: 'test' },
        ],
      });
      try {
        await expect(app.layers.add({ id: 'later', type: 'test' })).rejects.toMatchObject({
          code: 'LAYER_DUPLICATE',
        });
        expect(app.layers.getTree()).toEqual([]);
      } finally {
        release();
        await pending;
      }
      expect(app.layers.getChildren('group').map(({ id }) => id)).toEqual(['first', 'later']);
    } finally {
      await app.dispose();
    }
  });

  it('exposes immutable topology independently of adapter metadata and reused IDs', async () => {
    const app = createGISApp().use(
      createFakeMapPlugin(undefined, {
        test: createFakeLayerDefinition(() => ({
          setVisible() {},
          setZIndex() {},
          dispose() {},
          getMetadata: () => ({ id: 'fake', childIds: ['group'], parentId: 'fake' }),
        })),
      })
    );
    await app.init({
      layers: [{ id: 'group', type: 'GROUP', children: [{ id: 'child', type: 'test' }] }],
    });
    try {
      const [group] = app.layers.getTree();
      expect(group).toEqual({
        id: 'group',
        kind: 'group',
        parentId: null,
        children: [{ id: 'child', kind: 'leaf', parentId: 'group', children: [] }],
      });
      expect(Object.isFrozen(group?.children)).toBe(true);
      expect(app.layers.getLeaves('group').map(({ id }) => id)).toEqual(['child']);
      expect(app.layers.get('child')?.getMetadata().id).toBe('child');
      expect(app.context.state.snapshot().layers.find(({ id }) => id === 'child')).toMatchObject({
        parentId: 'group',
        childIds: [],
      });
      await app.layers.remove('child');
      await app.layers.add({ id: 'child', type: 'test' });
      expect(app.layers.getLeaves('group')).toEqual([]);
      expect(app.layers.get('child')?.parentId).toBeNull();
    } finally {
      await app.dispose();
    }
  });

  it('releases a pending child without attaching it after its parent ID is reused', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter = new FakeMapAdapter();
    const disposed = vi.fn();
    const app = createGISApp().use(
      createFakeMapPlugin(adapter, {
        test: {
          async create(_context, { id }) {
            if (id === 'pending') {
              await gate;
            }
            return { setVisible() {}, setZIndex() {}, dispose: () => disposed(id) };
          },
        },
      })
    );
    const group = {
      id: 'group',
      type: 'GROUP',
      children: [{ id: 'existing', type: 'test' }],
    };
    await app.init({ layers: [group] });
    try {
      const attach = vi.spyOn(adapter, 'addLayer');
      const pending = app.layers.addChild('group', { id: 'pending', type: 'test' });
      const rejected = expect(pending).rejects.toMatchObject({ code: 'LAYER_NOT_FOUND' });
      await app.layers.remove('group');
      await app.layers.add(group);
      release();
      await rejected;
      expect(attach).toHaveBeenCalledOnce();
      expect(disposed.mock.calls).toEqual([['existing'], ['pending']]);
      expect(app.layers.getChildren('group').map(({ id }) => id)).toEqual(['existing']);
    } finally {
      release();
      await app.dispose();
    }
  });

  it('passes a frozen configuration tree to asynchronous factories', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen = vi.fn();
    const app = createGISApp().use(
      createFakeMapPlugin(undefined, {
        test: {
          async create(_context, config) {
            await gate;
            seen(config);
            expect(Object.isFrozen(config)).toBe(true);
            expect(Object.isFrozen(config.style)).toBe(true);
            return { setVisible() {}, setZIndex() {}, dispose() {} };
          },
        },
      })
    );
    await app.init({});
    try {
      const child = {
        id: 'first',
        type: 'test',
        style: { fillColor: '#0099ff' },
        source: { data: [1] },
      };
      const second = { ...child, id: 'second', style: { ...child.style } };
      const children = [child, second];
      const adding = app.layers.add({ id: 'group', type: 'GROUP', children });
      child.id = 'changed';
      child.style.fillColor = '#ffffff';
      child.source.data.push(2);
      second.id = 'also-changed';
      children.length = 0;
      release();
      const group = await adding;
      expect(group.getMetadata().childIds).toEqual(['first', 'second']);
      expect(seen.mock.calls.map(([config]) => config.source)).toEqual([
        { data: [1] },
        { data: [1] },
      ]);
      expect(app.layers.get('first')?.style?.fillColor).toBe('#0099ff');
    } finally {
      release();
      await app.dispose();
    }
  });

  it('rejects malformed dynamic configs before allocating group children', async () => {
    const create = vi.fn(createFakeLayerDefinition().create);
    const app = createGISApp().use(createFakeMapPlugin(undefined, { test: { create } }));
    await app.init({});
    try {
      await expect(
        app.layers.add({
          id: 'group',
          type: 'GROUP',
          children: [
            { id: 'first', type: 'test' },
            { id: 'second', type: 'test', visible: 'false' as unknown as boolean },
          ],
        })
      ).rejects.toMatchObject({
        code: 'CONFIG_INVALID',
        detail: { path: 'layer.children[1].visible' },
      });
      expect(create).not.toHaveBeenCalled();
      expect(app.layers.list()).toEqual([]);
    } finally {
      await app.dispose();
    }
  });

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
            { id: 'b', type: 'raster', visible: false },
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
    expect(app.layers.get('c')).toMatchObject({ ownVisible: true, visible: false });
    app.layers.setVisibility('group', true);
    expect(app.layers.get('a')?.visible).toBe(true);
    expect(app.layers.get('b')).toMatchObject({ ownVisible: false, visible: false });
    expect(app.layers.get('c')?.visible).toBe(true);
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

  it('preserves nested gates and publishes child intent while ancestors are hidden', async () => {
    const app = createGISApp().use(
      createFakeMapPlugin(undefined, { test: createFakeLayerDefinition() })
    );
    await app.init({
      layers: [
        {
          id: 'root',
          type: 'GROUP',
          visible: false,
          children: [
            {
              id: 'nested',
              type: 'GROUP',
              visible: false,
              children: [{ id: 'seed', type: 'test' }],
            },
          ],
        },
      ],
    });
    try {
      const nested = app.layers.get('nested')!;
      await app.layers.remove('seed');
      const child = await app.layers.addChild('nested', {
        id: 'child',
        type: 'test',
        visible: false,
      });
      await child.update({ visible: true, title: 'Edited while hidden' });
      expect(child).toMatchObject({ ownVisible: true, visible: false });
      expect(app.context.state.snapshot().layers.find(({ id }) => id === 'child')).toMatchObject({
        ownVisible: true,
        visible: false,
      });
      await app.layers.update('root', { visible: true });
      expect(nested).toMatchObject({ ownVisible: false, visible: false });
      expect(child.visible).toBe(false);
      nested.setVisibility(true);
      expect(child.visible).toBe(true);
      await app.layers.remove('child');
      expect(nested).toMatchObject({ ownVisible: true, visible: true });
      expect(nested.getMetadata().childIds).toEqual([]);
    } finally {
      await app.dispose();
    }
  });

  it('restores already projected leaves if a group visibility setter throws', async () => {
    const visible = new Map([
      ['first', true],
      ['second', true],
    ]);
    const failure = new Error('setter failed after changing the second leaf');
    let failOnce = true;
    const app = createGISApp().use(
      createFakeMapPlugin(undefined, {
        test: createFakeLayerDefinition(({ id }) => ({
          setVisible(next) {
            visible.set(id, next);
            if (id === 'second' && failOnce) {
              failOnce = false;
              throw failure;
            }
          },
          setZIndex() {},
          dispose() {},
        })),
      })
    );
    await app.init({
      layers: [
        {
          id: 'group',
          type: 'GROUP',
          children: [
            { id: 'first', type: 'test' },
            { id: 'second', type: 'test' },
          ],
        },
      ],
    });
    try {
      const events = vi.fn();
      app.layers.subscribe(events);
      const before = app.context.state.snapshot().layers;
      expect(() => app.layers.setVisibility('group', false)).toThrow(failure);
      expect([...visible.values()]).toEqual([true, true]);
      expect(app.context.state.snapshot().layers).toBe(before);
      expect(events).not.toHaveBeenCalled();
      app.layers.setVisibility('group', false);
      expect([...visible.values()]).toEqual([false, false]);
    } finally {
      await app.dispose();
    }
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
    const created = vi.fn();
    const factoryFailure = new Error('injected factory failure');
    const app = createGISApp().use(
      createFakeMapPlugin(new FakeMapAdapter(), {
        staged: {
          async create(_context, config) {
            created(config.id);
            if (config.id === 'broken') {
              throw factoryFailure;
            }
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
      expect(created).not.toHaveBeenCalledWith('temporary');
      expect(disposed).not.toHaveBeenCalledWith('temporary');
      await expect(
        app.layers.add({
          id: 'failed',
          type: 'GROUP',
          children: [
            { id: 'temporary', type: 'staged' },
            { id: 'broken', type: 'staged' },
          ],
        })
      ).rejects.toBe(factoryFailure);
      expect(events).toHaveLength(3);
      expect(disposed).toHaveBeenCalledWith('temporary');
      await app.layers.add({ id: 'temporary', type: 'staged' });
    } finally {
      release();
      await app.dispose();
    }
  });
});
