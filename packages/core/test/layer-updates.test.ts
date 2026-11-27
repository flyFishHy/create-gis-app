import { expect, it, vi } from 'vitest';
import { createGISApp, defineLayerType } from '../src/index.js';
import { createFakeLayerDefinition, createFakeMapPlugin, FakeMapAdapter } from './fake-map.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('commits and reads grouped capabilities on a third-party handle', async () => {
  const temporal = {
    filter: undefined as import('../src/types.js').LayerTimeFilter | undefined,
    getTimeFilter() {
      return this.filter;
    },
    setTimeFilter(filter: typeof this.filter) {
      this.filter = filter;
    },
  };
  const app = createGISApp().use(
    createFakeMapPlugin(undefined, {
      test: defineLayerType({
        normalize(config) {
          return { ...config, source: { value: Number(config.source) } };
        },
        create(_context, config) {
          return {
            setVisible() {},
            setZIndex() {},
            dispose() {},
            capabilities: {
              temporal,
              attributes: { getFieldValues: () => [config.source.value] },
            },
          };
        },
      }),
    })
  );
  await app.init({ layers: [{ id: 'custom', type: 'test', source: '3' }] });
  try {
    const layer = app.layers.get('custom')!;
    expect(layer.getFieldValues('value')).toEqual([3]);
    const filter = { field: 'time', start: 0, end: 1 };
    layer.setTimeFilter(filter);
    expect(layer.getTimeFilter()).toEqual(filter);
    expect(layer.version).toBe(1);
    await layer.dispose();
    expect(layer.getTimeFilter()).toBeUndefined();
    expect(() => layer.setTimeFilter(filter)).toThrow(
      expect.objectContaining({ code: 'APP_DISPOSED' })
    );
  } finally {
    await app.dispose();
  }
});

it('restores both zIndex and visibility when a combined group update fails', async () => {
  const writes = new Map<string, { visible: boolean; zIndex: number }>();
  const failure = new Error('injected visibility failure');
  let fail = false;
  const app = createGISApp().use(
    createFakeMapPlugin(undefined, {
      test: createFakeLayerDefinition(({ id }) => {
        const state = { visible: true, zIndex: 0 };
        writes.set(id, state);
        return {
          setVisible(visible) {
            state.visible = visible;
            if (fail && id === 'second' && !visible) throw failure;
          },
          setZIndex(zIndex) {
            state.zIndex = zIndex;
          },
          dispose() {},
        };
      }),
    })
  );
  await app.init({
    layers: [
      {
        id: 'group',
        type: 'GROUP',
        children: [
          { id: 'first', type: 'test', zIndex: 3 },
          { id: 'second', type: 'test', zIndex: 5 },
        ],
      },
    ],
  });
  try {
    fail = true;
    const events = vi.fn();
    app.layers.subscribe(events);
    const group = app.layers.get('group')!;
    const snapshot = app.context.state.snapshot();
    await expect(group.update({ visible: false, zIndex: 10 })).rejects.toBe(failure);
    expect(writes.get('first')).toEqual({ visible: true, zIndex: 3 });
    expect(writes.get('second')).toEqual({ visible: true, zIndex: 5 });
    expect(app.context.state.snapshot()).toBe(snapshot);
    expect(events).not.toHaveBeenCalled();
  } finally {
    await app.dispose();
  }
});

it.each(['service', 'instance'] as const)(
  'publishes committed state and equivalent events through the %s entry point',
  async (entry) => {
    const app = createGISApp().use(
      createFakeMapPlugin(undefined, { test: createFakeLayerDefinition() })
    );
    await app.init({ layers: [{ id: 'one', type: 'test' }] });
    try {
      const layer = app.layers.get('one')!;
      const timeline: unknown[] = [];
      const snapshotVersion = () => app.context.state.snapshot().layers[0]?.version;
      app.context.state.subscribe((snapshot) =>
        timeline.push(['state', snapshot.layers[0]?.version])
      );
      app.events.on('layer:visibility-changed', (event) =>
        timeline.push(['app visibility', event, snapshotVersion()])
      );
      app.events.on('layer:updated', (event) =>
        timeline.push(['app update', event, snapshotVersion()])
      );
      app.layers.subscribe((event) => timeline.push(['service', event, snapshotVersion()]));
      const target =
        entry === 'instance'
          ? layer
          : {
              setVisibility: (visible: boolean) => app.layers.setVisibility('one', visible),
              update: (patch: Parameters<typeof layer.update>[0]) =>
                app.layers.update('one', patch),
            };
      target.setVisibility(false);
      await target.update({ title: 'Updated' });
      await target.update({ title: 'Visible', visible: true });
      expect(timeline).toEqual([
        ['state', 1],
        ['app visibility', { layerId: 'one', visible: false }, 1],
        ['service', { type: 'visibility', id: 'one', visible: false }, 1],
        ['state', 2],
        ['app update', { layerId: 'one' }, 2],
        ['service', { type: 'update', id: 'one' }, 2],
        ['state', 3],
        ['app visibility', { layerId: 'one', visible: true }, 3],
        ['service', { type: 'visibility', id: 'one', visible: true }, 3],
      ]);
    } finally {
      await app.dispose();
    }
  }
);

it('publishes group visibility events only after the whole cascade is reflected in state', async () => {
  const app = createGISApp().use(
    createFakeMapPlugin(undefined, { test: createFakeLayerDefinition() })
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
    const events: [string | undefined, boolean[]][] = [];
    const state = vi.fn();
    app.context.state.subscribe(state);
    const stop = app.layers.subscribe((event) => {
      events.push([event.id, app.context.state.snapshot().layers.map((layer) => layer.visible)]);
    });
    app.layers.get('group')!.setVisibility(false);
    expect(state).toHaveBeenCalledOnce();
    expect(events).toEqual([
      ['first', [false, false, false]],
      ['second', [false, false, false]],
      ['group', [false, false, false]],
    ]);
    events.length = 0;
    await app.layers.addChild('group', { id: 'third', type: 'test' });
    expect(events.map(([id]) => id)).toEqual(['third']);
    stop();
  } finally {
    await app.dispose();
  }
});

it('checks edit versions inside the serialized queue and rejects stale edits before engine mutation', async () => {
  const gate = deferred(),
    started = deferred(),
    apply = vi.fn(async () => {
      started.resolve();
      await gate.promise;
    });
  const app = createGISApp();
  app.use(
    createFakeMapPlugin(undefined, {
      test: createFakeLayerDefinition(() => ({
        setVisible() {},
        setZIndex() {},
        dispose() {},
        update: apply,
      })),
    })
  );
  try {
    await app.init({ layers: [{ id: 'one', type: 'test', title: 'Before' }] });
    const layer = app.layers.get('one')!,
      version = layer.version;
    const first = app.layers.update('one', { title: 'External' });
    await started.promise;
    const stale = app.layers.update('one', { title: 'Stale edit', expectedVersion: version });
    const rejected = expect(stale).rejects.toMatchObject({
      code: 'APP_INVALID_STATE',
      stage: 'layer-update',
    });
    gate.resolve();
    await first;
    await rejected;
    expect(apply).toHaveBeenCalledOnce();
    expect(layer.title).toBe('External');
    expect(layer.version).toBe(version + 1);
    expect(app.context.state.snapshot().layers[0]?.version).toBe(layer.version);
  } finally {
    gate.resolve();
    await app.dispose();
  }
});

it.each(['remove', 'dispose'] as const)(
  'waits for an active update before %s and rejects its stale commit',
  async (action) => {
    const gate = deferred(),
      started = deferred();
    const release = vi.fn(),
      visible = vi.fn();
    const app = createGISApp();
    app.use(
      createFakeMapPlugin(new FakeMapAdapter(), {
        test: createFakeLayerDefinition(() => ({
          setVisible: visible,
          setZIndex() {},
          dispose: release,
          update: () => {
            started.resolve();
            return gate.promise;
          },
        })),
      })
    );
    await app.init({ layers: [{ id: 'one', type: 'test', title: 'Before' }] });
    const layer = app.layers.get('one')!;
    const update = app.layers.update('one', { title: 'After', visible: false });
    const failed = expect(update).rejects.toMatchObject({ code: 'APP_DISPOSED' });
    await started.promise;
    const queued = layer.update({ title: 'Queued' });
    const queuedFailed = expect(queued).rejects.toMatchObject({ code: 'APP_DISPOSED' });
    const removal = action === 'remove' ? app.layers.remove('one') : app.dispose();
    expect(release).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all([failed, queuedFailed, removal]);
    expect(layer.title).toBe('Before');
    expect(visible).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    await app.dispose();
  }
);

it('rejects synchronous visibility during a legacy update and allows it after commit', async () => {
  const gate = deferred();
  const started = deferred();
  const setVisible = vi.fn();
  const app = createGISApp().use(
    createFakeMapPlugin(undefined, {
      test: createFakeLayerDefinition(() => ({
        setVisible,
        setZIndex() {},
        dispose() {},
        async update() {
          started.resolve();
          await gate.promise;
        },
      })),
    })
  );
  await app.init({ layers: [{ id: 'one', type: 'test' }] });
  try {
    const layer = app.layers.get('one')!;
    const pending = layer.update({ visible: false });
    await started.promise;
    expect(() => layer.setVisibility(true)).toThrow(
      expect.objectContaining({ detail: { layerId: 'one', reason: 'busy' } })
    );
    expect(layer.visible).toBe(true);
    gate.resolve();
    await pending;
    expect(setVisible.mock.calls).toEqual([[false]]);
    expect(layer.visible).toBe(false);
    layer.setVisibility(true);
    expect(setVisible.mock.calls).toEqual([[false], [true]]);
    expect(layer.version).toBe(2);
  } finally {
    gate.resolve();
    await app.dispose();
  }
});

it('serializes updates, recovers after failure and rejects unsupported options before committing metadata', async () => {
  const gate = deferred(),
    started = deferred(),
    calls: string[] = [];
  const app = createGISApp();
  app.use(
    createFakeMapPlugin(new FakeMapAdapter(), {
      test: createFakeLayerDefinition((config) => ({
        setVisible() {},
        setZIndex() {},
        dispose() {},
        ...(config.id === 'basic'
          ? {}
          : {
              async update(patch) {
                calls.push(patch.title!);
                if (patch.title === 'First') {
                  started.resolve();
                  await gate.promise;
                  throw new Error('Rejected');
                }
              },
            }),
      })),
    })
  );
  try {
    await app.init({
      layers: [
        { id: 'one', type: 'test' },
        { id: 'basic', type: 'test', title: 'Before' },
      ],
    });
    const first = app.layers.update('one', { title: 'First' });
    const failed = expect(first).rejects.toThrow('Rejected');
    await started.promise;
    const second = app.layers.update('one', { title: 'Second' });
    expect(calls).toEqual(['First']);
    gate.resolve();
    await Promise.all([failed, second]);
    expect(calls).toEqual(['First', 'Second']);
    expect(app.layers.get('one')!.title).toBe('Second');
    await expect(
      app.layers.update('basic', { title: 'After', options: { opacity: 0.5 } })
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
    expect(app.layers.get('basic')!.title).toBe('Before');
  } finally {
    await app.dispose();
  }
});

it('captures a queued update and its nested options when the caller submits it', async () => {
  const gate = deferred();
  const started = deferred();
  const apply = vi.fn(async (patch: import('../src/types.js').LayerUpdate) => {
    if (patch.title === 'First') {
      started.resolve();
      await gate.promise;
    }
  });
  const app = createGISApp().use(
    createFakeMapPlugin(undefined, {
      test: createFakeLayerDefinition(() => ({
        setVisible() {},
        setZIndex() {},
        dispose() {},
        update: apply,
      })),
    })
  );
  await app.init({ layers: [{ id: 'one', type: 'test' }] });
  try {
    const layer = app.layers.get('one')!;
    const first = layer.update({ title: 'First' });
    await started.promise;
    const patch = { title: 'Queued', options: { custom: { value: 0.5 } }, expectedVersion: 1 };
    const queued = layer.update(patch);
    patch.title = 'Changed';
    patch.options.custom.value = 1;
    patch.expectedVersion = 0;
    gate.resolve();
    await Promise.all([first, queued]);
    expect(apply).toHaveBeenLastCalledWith({
      title: 'Queued',
      options: { custom: { value: 0.5 } },
    });
    expect(layer.title).toBe('Queued');
  } finally {
    gate.resolve();
    await app.dispose();
  }
});
