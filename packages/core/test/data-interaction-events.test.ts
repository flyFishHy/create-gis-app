import { describe, expect, it, vi } from 'vitest';
import { createGISApp } from '../src/gis-app.js';
import type { DataProcessor, GISPlugin, ToolDefinition } from '../src/types.js';

describe('DataService', () => {
  it('loads inline data through a registered processor and disposes datasets', async () => {
    const app = createGISApp();
    const process = vi.fn((input: unknown, _context: Parameters<DataProcessor['process']>[1]) => ({
      result: input,
    }));
    const processor: DataProcessor = { process };
    const plugin: GISPlugin = {
      name: 'data-plugin',
      install(runtime, _options, resources) {
        runtime.registerDataProcessor('wrap', processor, resources);
      },
    };
    app.use(plugin);
    await app.init({});
    const dataSet = await app.data.load(
      { type: 'inline', data: [1, 2] },
      { id: 'numbers', processor: 'wrap' }
    );
    expect(dataSet.status).toBe('ready');
    expect(dataSet.data).toEqual({ result: [1, 2] });
    expect(process).toHaveBeenCalledOnce();
    await app.data.remove('numbers');
    expect(dataSet.status).toBe('disposed');
    expect(dataSet.data).toBeUndefined();
    await app.dispose();
  });

  it('records failed loads and rejects duplicate dataset ids', async () => {
    const app = createGISApp();
    await app.init({});
    await expect(app.data.load({ type: 'url', url: '' }, { id: 'invalid' })).rejects.toMatchObject({
      code: 'DATA_LOAD_FAILED',
    });
    expect(app.data.get('invalid')?.status).toBe('error');
    await expect(
      app.data.load({ type: 'inline', data: 1 }, { id: 'invalid' })
    ).rejects.toMatchObject({ code: 'DATASET_DUPLICATE' });
    await app.dispose();
  });
});

describe('InteractionService and EventService', () => {
  it('notifies selection subscribers and emits feature events', async () => {
    const app = createGISApp();
    await app.init({});
    const selections: unknown[] = [];
    const select = app.interactions.onSelect((feature) => selections.push(feature));
    const event = vi.fn();
    app.events.on('feature:selected', event);
    app.interactions.select({
      feature: { id: 7, layerId: 'roads', properties: { class: 'primary' } },
    });
    app.interactions.clearSelection();
    expect(selections).toHaveLength(2);
    expect(selections[0]).toMatchObject({ layerId: 'roads', id: 7 });
    expect(event).toHaveBeenCalledTimes(2);
    select();
    await app.dispose();
  });

  it('activates tools exclusively and deactivates an active tool during disposal', async () => {
    const app = createGISApp();
    const events: string[] = [];
    const first: ToolDefinition = {
      id: 'first',
      activate: () => {
        events.push('first+');
      },
      deactivate: () => {
        events.push('first-');
      },
    };
    const second: ToolDefinition = {
      id: 'second',
      activate: () => {
        events.push('second+');
      },
      deactivate: () => {
        events.push('second-');
      },
    };
    app.use({
      name: 'tools',
      install(runtime, _options, resources) {
        runtime.registerTool('first', first, resources);
        runtime.registerTool('second', second, resources);
      },
    });
    await app.init({});
    await app.interactions.activateTool('first');
    await app.interactions.activateTool('second');
    expect(events).toEqual(['first+', 'first-', 'second+']);
    await app.dispose();
    expect(events).toEqual(['first+', 'first-', 'second+', 'second-']);
  });

  it('supports once listeners and unsubscribe during event dispatch', async () => {
    const app = createGISApp();
    await app.init({});
    const calls: string[] = [];
    app.events.once('app:ready', () => calls.push('once'));
    let stop: () => void = () => {};
    stop = app.events.on('app:ready', () => {
      calls.push('normal');
      stop();
    });
    app.events.emit('app:ready', { appId: app.id });
    app.events.emit('app:ready', { appId: app.id });
    expect(calls).toEqual(['once', 'normal']);
    await app.dispose();
  });
});
