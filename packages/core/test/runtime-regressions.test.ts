import { expect, it, vi } from 'vitest';
import { createGISApp } from '../src/index.js';
import { createFakeLayerDefinition, createFakeMapPlugin, FakeMapAdapter } from './fake-map.js';

it('keeps services available after UI mount and unmount', async () => {
  const app = createGISApp();
  app.use(createFakeMapPlugin(undefined, { test: createFakeLayerDefinition() }));
  app.use({
    name: 'ui',
    install(a, _, scope) {
      a.registerUIAdapter({ mount() {}, unmount() {}, dispose() {} }, scope);
      a.registerTool('draw', { id: 'draw', activate() {} }, scope);
    },
  });
  await app.init({});
  try {
    await app.mount(document.createElement('div'));
    await app.layers.add({ id: 'mounted', type: 'test' });
    await app.data.load({ type: 'inline', data: {} });
    await app.interactions.activateTool('draw');
    await app.unmount();
    await app.layers.add({ id: 'unmounted', type: 'test' });
    expect(app.layers.list()).toHaveLength(2);
  } finally {
    await app.dispose();
  }
});

it('reserves pending ids, synchronizes ordering, and isolates observer failures', async () => {
  const app = createGISApp();
  const adapter = new FakeMapAdapter();
  app.use(
    createFakeMapPlugin(adapter, {
      test: {
        async create() {
          await Promise.resolve();
          return { setVisible() {}, setZIndex() {}, dispose() {} };
        },
      },
    })
  );
  await app.init({});
  try {
    const results = await Promise.allSettled([
      app.layers.add({ id: 'a', type: 'test' }),
      app.layers.add({ id: 'a', type: 'test' }),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(adapter.handles).toHaveLength(1);
    app.events.on('layer:added', () => {
      throw new Error('consumer');
    });
    await app.layers.add({ id: 'b', type: 'test' });
    app.layers.setOrder(['b', 'a']);
    expect(app.layers.list().map((l) => l.id)).toEqual(['b', 'a']);
    expect(adapter.handles).toHaveLength(2);
  } finally {
    await app.dispose();
  }
});

it('updates group metadata after child removal and cleans parent idempotently', async () => {
  const app = createGISApp();
  app.use(createFakeMapPlugin(undefined, { test: createFakeLayerDefinition() }));
  await app.init({});
  await app.layers.add({ id: 'g', type: 'GROUP', children: [{ id: 'c', type: 'test' }] });
  await app.layers.remove('c');
  expect(app.layers.get('g')!.getMetadata().childIds).toEqual([]);
  await app.layers.remove('g');
  expect(app.layers.list()).toEqual([]);
  await app.dispose();
});

it('can reapply the committed order after an engine setter interrupts reordering', async () => {
  const adapter = new FakeMapAdapter();
  const writes = new Map<string, number>();
  const failure = new Error('injected zIndex setter failure');
  const app = createGISApp().use(
    createFakeMapPlugin(adapter, {
      test: createFakeLayerDefinition(({ id }) => ({
        setVisible() {},
        setZIndex(value) {
          writes.set(id, value);
        },
        dispose() {},
      })),
    })
  );
  const previous = ['first', 'second', 'third'];
  await app.init({ layers: previous.map((id) => ({ id, type: 'test' })) });
  try {
    app.layers.setOrder(previous);
    const handles = [...adapter.handles];
    const second = handles[1]!;
    const setZIndex = second.setZIndex.bind(second);
    vi.spyOn(second, 'setZIndex').mockImplementationOnce((value) => {
      setZIndex(value);
      throw failure;
    });
    const events = vi.fn();
    app.layers.subscribe(events);
    expect(() => app.layers.setOrder([...previous].reverse())).toThrow(failure);
    expect(app.layers.list().map(({ id }) => id)).toEqual(previous);
    expect(events).not.toHaveBeenCalled();
    expect(adapter.handles).toEqual([...handles].reverse());
    app.layers.setOrder(previous);
    expect(adapter.handles).toEqual(handles);
    expect(previous.map((id) => writes.get(id))).toEqual([0, 1, 2]);
    expect(events).toHaveBeenCalledExactlyOnceWith({ type: 'order' });
  } finally {
    await app.dispose();
  }
});
