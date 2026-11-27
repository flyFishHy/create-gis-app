import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGISApp, defineLayerType } from '@joinmap/gis-core';
import type { LayerConfig } from '@joinmap/gis-core';
import Heatmap from 'ol/layer/Heatmap.js';
import VectorSource from 'ol/source/Vector.js';
import { createOLAdapter, createOLLayerHandle } from '../../src/index.js';
import type { XYZLayerConfig } from '../../src/index.js';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => vi.unstubAllGlobals());

const xyz = {
  id: 'tiles',
  type: 'xyz',
  source: { url: '/{z}/{x}/{y}.png' },
} satisfies XYZLayerConfig;

// @ts-expect-error XYZ configuration requires a URL.
const invalidXYZ: XYZLayerConfig = { id: 'missing-url', type: 'xyz', source: {} };

it.each([
  [invalidXYZ, 'source.url'],
  [
    { id: 'bad', type: 'wms', source: { url: '/wms', params: { LAYERS: 'layer', BAD: [] } } },
    'source.params.BAD',
  ],
  [{ id: 'bad', type: 'wmts', source: { url: '/wmts', layer: 'layer' } }, 'source.matrixSet'],
  [{ id: 'bad', type: 'geojson', source: { type: 'inline' } }, 'source.data'],
  [{ ...xyz, id: 'bad', options: { typo: 1 } }, 'options'],
] satisfies readonly [LayerConfig, string][])(
  'preflights %j for initial and dynamic branches',
  async (invalid, field) => {
    const create = vi.fn(() => ({ setVisible() {}, setZIndex() {}, dispose() {} }));
    const createApp = () =>
      createGISApp()
        .use(createOLAdapter({ tools: false }))
        .use({
          name: 'preflight-observer',
          install(app, _options, scope) {
            app.registerLayerType('custom', { create }, scope);
          },
        });
    const first = { id: 'first', type: 'custom' };
    const initial = createApp();
    try {
      await expect(initial.init({ layers: [first, invalid] })).rejects.toMatchObject({
        code: 'CONFIG_INVALID',
        detail: { layerId: invalid.id, path: `layers[1].${field}` },
      });
      expect(create).not.toHaveBeenCalled();
    } finally {
      await initial.dispose();
    }

    const dynamic = createApp();
    await dynamic.init({ layers: [xyz] });
    try {
      await expect(
        dynamic.layers.add({ id: 'branch', type: 'GROUP', children: [first, invalid] })
      ).rejects.toMatchObject({
        code: 'CONFIG_INVALID',
        detail: { layerId: invalid.id, path: `layers.branch.children[1].${field}` },
      });
      expect(create).not.toHaveBeenCalled();
      expect(dynamic.layers.get('tiles')?.getFields()).toEqual([]);
      expect(dynamic.layers.get('tiles')?.style).toBeUndefined();
    } finally {
      await dynamic.dispose();
    }
  }
);

function size(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} requires a finite nonnegative number.`);
  }
  return value;
}

it('registers a Heatmap with its own config and rollback strategy', async () => {
  const context2D = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
  context2D.mockImplementation(function (this: HTMLCanvasElement) {
    return {
      canvas: this,
      createLinearGradient: () => ({ addColorStop() {} }),
      fillRect() {},
    } as unknown as CanvasRenderingContext2D;
  });
  let heatmap: Heatmap | undefined;
  const dispose = vi.fn();
  const app = createGISApp()
    .use(createOLAdapter({ tools: false }))
    .use({
      name: 'heatmap-fixture',
      install(runtime, _options, scope) {
        runtime.registerLayerType(
          'heatmap',
          defineLayerType({
            normalize(config) {
              return {
                ...config,
                options: {
                  radius: size(config.options?.radius, 'radius'),
                  blur: size(config.options?.blur, 'blur'),
                },
              };
            },
            create(context, config) {
              const source = new VectorSource();
              const layer = new Heatmap({ source, ...config.options });
              heatmap = layer;
              return createOLLayerHandle(context, layer, config, {
                dispose: () => {
                  dispose();
                  layer.dispose();
                  source.dispose();
                },
                validateOptions(options) {
                  for (const [name, value] of Object.entries(options)) {
                    if (name !== 'radius' && name !== 'blur')
                      throw new Error(`Unknown heatmap option ${name}`);
                    size(value, name);
                  }
                },
                prepareUpdate(patch) {
                  const { radius = layer.getRadius(), blur = layer.getBlur() } =
                    patch.options ?? {};
                  const nextRadius = size(radius, 'radius');
                  const nextBlur = size(blur, 'blur');
                  const previousRadius = layer.getRadius();
                  const previousBlur = layer.getBlur();
                  return {
                    apply: () => {
                      layer.setRadius(nextRadius);
                      layer.setBlur(nextBlur);
                    },
                    rollback: () => {
                      layer.setRadius(previousRadius);
                      layer.setBlur(previousBlur);
                    },
                  };
                },
              });
            },
          }),
          scope
        );
      },
    });
  await app.init({ layers: [xyz] });
  try {
    await expect(
      app.layers.add({ id: 'heat', type: 'heatmap', options: { radius: -1, blur: 15 } })
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
    expect(heatmap).toBeUndefined();
    const instance = await app.layers.add({
      id: 'heat',
      type: 'heatmap',
      options: { radius: 8, blur: 15 },
    });
    const layer = heatmap!;
    instance.setVisibility(false);
    app.layers.setOrder(['heat', 'tiles']);
    expect(layer.getZIndex()).toBe(0);
    await instance.update({ options: { radius: 12 } });
    expect(layer.getRadius()).toBe(12);
    const failure = new Error('injected OL setter failure');
    const setVisible = layer.setVisible.bind(layer);
    vi.spyOn(layer, 'setVisible').mockImplementationOnce((visible) => {
      setVisible(visible);
      throw failure;
    });
    await expect(instance.update({ visible: true, options: { radius: 20 } })).rejects.toBe(failure);
    expect(layer.getRadius()).toBe(12);
    expect(layer.getVisible()).toBe(false);
    expect(instance.visible).toBe(false);
    await expect(instance.update({ options: { blur: -1 } })).rejects.toThrow('blur');
    expect(layer.getBlur()).toBe(15);
    await instance.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  } finally {
    await app.dispose();
    context2D.mockRestore();
  }
});
