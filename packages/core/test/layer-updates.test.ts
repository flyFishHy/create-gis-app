import { expect, it, vi } from 'vitest';
import { createGISApp } from '../src/index.js';
import { createFakeLayerDefinition, createFakeMapPlugin, FakeMapAdapter } from './fake-map.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

it('applies visibility after a pending legacy update without publishing stale state', async () => {
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
    layer.setVisibility(true);
    expect(layer.visible).toBe(true);
    gate.resolve();
    await pending;
    expect(setVisible.mock.calls).toEqual([[true], [false]]);
    expect(layer.visible).toBe(false);
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
