import { expect, it, vi } from 'vitest';
import { createGISApp } from '../src/index.js';
import { createFakeLayerDefinition, createFakeMapPlugin, FakeMapAdapter } from './fake-map.js';

it('does not adopt an independent replacement with a former child ID', async () => {
  const app = createGISApp();
  app.use(createFakeMapPlugin(undefined, { test: createFakeLayerDefinition() }));
  await app.init({});
  try {
    await app.layers.add({ id: 'group', type: 'GROUP', children: [{ id: 'child', type: 'test' }] });
    await app.layers.remove('child');
    await app.layers.add({ id: 'child', type: 'test' });
    expect(app.layers.get('group')!.getMetadata().childIds).toEqual([]);
    app.layers.setVisibility('group', false);
    expect(app.layers.get('child')!.visible).toBe(true);
    await app.layers.remove('group');
    expect(app.layers.has('child')).toBe(true);
  } finally {
    await app.dispose();
  }
});

it('validates before commit and isolates observers after commit', async () => {
  const app = createGISApp();
  await app.init({});
  try {
    const data = await app.data.load<number>({ type: 'inline', data: 1 });
    data.validate((value) => {
      if (value < 0) throw new Error('negative');
    });
    const listener = vi.fn();
    data.subscribe(() => {
      throw new Error('observer');
    });
    data.subscribe(listener);
    expect(() => data.update(-1)).toThrow('negative');
    expect(data.data).toBe(1);
    expect(data.status).toBe('ready');
    expect(listener).not.toHaveBeenCalled();
    data.update(2);
    expect(listener).toHaveBeenCalledWith(2);
  } finally {
    await app.dispose();
  }
});

it('attempts handle disposal even when adapter removal fails', async () => {
  const app = createGISApp();
  const adapter = new FakeMapAdapter();
  const dispose = vi.fn();
  app.use(
    createFakeMapPlugin(adapter, {
      test: createFakeLayerDefinition(() => ({ setVisible() {}, setZIndex() {}, dispose })),
    })
  );
  await app.init({});
  await app.layers.add({ id: 'test', type: 'test' });
  vi.spyOn(adapter, 'removeLayer').mockImplementation(() => {
    throw new Error('remove failed');
  });
  await expect(app.layers.remove('test')).rejects.toMatchObject({ code: 'APP_DISPOSE_FAILED' });
  expect(dispose).toHaveBeenCalledOnce();
  await app.dispose();
});

it('rolls back a partially attached group child and lets the same IDs be retried', async () => {
  const adapter = new FakeMapAdapter();
  const failure = new Error('attach failed after inserting the child');
  const disposed = vi.fn();
  const app = createGISApp().use(
    createFakeMapPlugin(adapter, {
      test: createFakeLayerDefinition(({ id }) => ({
        setVisible() {},
        setZIndex() {},
        dispose: () => disposed(id),
      })),
    })
  );
  const config = {
    id: 'group',
    type: 'GROUP',
    children: [
      { id: 'first', type: 'test' },
      { id: 'second', type: 'test' },
    ],
  };
  await app.init({});
  try {
    const add = adapter.addLayer.bind(adapter);
    vi.spyOn(adapter, 'addLayer').mockImplementation((handle) => {
      add(handle);
      if (adapter.handles.length === 2) throw failure;
    });
    await expect(app.layers.add(config)).rejects.toBe(failure);
    expect(adapter.handles).toEqual([]);
    expect(app.layers.list()).toEqual([]);
    expect(disposed.mock.calls).toEqual([['second'], ['first']]);
    vi.mocked(adapter.addLayer).mockRestore();
    await app.layers.add(config);
    expect(adapter.handles).toHaveLength(2);
    expect(app.layers.get('group')?.getMetadata().childIds).toEqual(['first', 'second']);
  } finally {
    await app.dispose();
  }
});

it('preserves the attach failure and collects cleanup errors from the handle and staged tree', async () => {
  const adapter = new FakeMapAdapter();
  const failure = new Error('attach failed');
  const detachFailure = new Error('detach failed');
  const childCleanup = new Error('child dispose failed');
  const stagedCleanup = new Error('staged dispose failed');
  const disposed = vi.fn((id: string) => {
    throw id === 'second' ? childCleanup : stagedCleanup;
  });
  const app = createGISApp().use(
    createFakeMapPlugin(adapter, {
      test: createFakeLayerDefinition(({ id }) => ({
        setVisible() {},
        setZIndex() {},
        dispose: () => disposed(id),
      })),
    })
  );
  await app.init({});
  try {
    const add = adapter.addLayer.bind(adapter);
    vi.spyOn(adapter, 'addLayer').mockImplementation((handle) => {
      add(handle);
      if (adapter.handles.length === 2) throw failure;
    });
    const remove = adapter.removeLayer.bind(adapter);
    vi.spyOn(adapter, 'removeLayer').mockImplementationOnce((handle) => {
      remove(handle);
      throw detachFailure;
    });
    await expect(
      app.layers.add({
        id: 'group',
        type: 'GROUP',
        children: [
          { id: 'nested', type: 'GROUP', children: [{ id: 'first', type: 'test' }] },
          { id: 'second', type: 'test' },
        ],
      })
    ).rejects.toMatchObject({
      code: 'LAYER_CREATE_FAILED',
      cause: failure,
      cleanupErrors: [detachFailure, childCleanup, stagedCleanup],
    });
    expect(disposed.mock.calls).toEqual([['second'], ['first']]);
    expect(adapter.handles).toEqual([]);
    expect(app.layers.list()).toEqual([]);
  } finally {
    await app.dispose();
  }
});

it('waits for pending creation cleanup and releases plugins before the map', async () => {
  const app = createGISApp();
  const adapter = new FakeMapAdapter();
  let finish!: () => void;
  const disposed = vi.fn();
  const pluginCleanup = vi.fn(() => expect(adapter.destroyed).toBe(false));
  app.use(
    createFakeMapPlugin(adapter, {
      test: {
        create: () =>
          new Promise((resolve) => {
            finish = () => resolve({ setVisible() {}, setZIndex() {}, dispose: disposed });
          }),
      },
    })
  );
  app.use({
    name: 'extension',
    install(_, __, resources) {
      resources.add(pluginCleanup);
    },
  });
  await app.init({});
  const adding = app.layers.add({ id: 'pending', type: 'test' });
  const rejected = expect(adding).rejects.toMatchObject({ code: 'APP_DISPOSED' });
  const disposal = app.dispose();
  await Promise.resolve();
  expect(adapter.destroyed).toBe(false);
  finish();
  await Promise.all([rejected, disposal]);
  expect(disposed).toHaveBeenCalledOnce();
  expect(pluginCleanup).toHaveBeenCalledOnce();
  expect(adapter.destroyed).toBe(true);
});
