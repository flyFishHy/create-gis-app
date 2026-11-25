import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGISApp } from '@joinmap/gis-core';
import TileLayer from 'ol/layer/Tile.js';
import VectorLayer from 'ol/layer/Vector.js';
import { get as getProjection } from 'ol/proj.js';
import TileWMS from 'ol/source/TileWMS.js';
import WMTS from 'ol/source/WMTS.js';
import { createOLAdapter, useOLMap } from '../../src/index.js';

const wmtsConfig = {
  id: 'base',
  type: 'wmts',
  source: {
    url: 'https://example.test/wmts?SERVICE=WMTS&REQUEST=GetCapabilities',
    layer: 'basemap',
    matrixSet: 'web-mercator',
  },
} as const;

const capabilities = `<?xml version="1.0" encoding="UTF-8"?>
<Capabilities version="1.0.0" xmlns="http://www.opengis.net/wmts/1.0"
  xmlns:ows="http://www.opengis.net/ows/1.1" xmlns:xlink="http://www.w3.org/1999/xlink">
  <ows:OperationsMetadata>
    <ows:Operation name="GetTile">
      <ows:DCP><ows:HTTP><ows:Get xlink:href="https://example.test/wmts">
        <ows:Constraint name="GetEncoding">
          <ows:AllowedValues><ows:Value>KVP</ows:Value></ows:AllowedValues>
        </ows:Constraint>
      </ows:Get></ows:HTTP></ows:DCP>
    </ows:Operation>
  </ows:OperationsMetadata>
  <Contents>
    <Layer>
      <ows:Identifier>basemap</ows:Identifier>
      <Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style>
      <Format>image/png</Format>
      <TileMatrixSetLink><TileMatrixSet>web-mercator</TileMatrixSet></TileMatrixSetLink>
    </Layer>
    <TileMatrixSet>
      <ows:Identifier>web-mercator</ows:Identifier>
      <ows:SupportedCRS>EPSG:3857</ows:SupportedCRS>
      <TileMatrix>
        <ows:Identifier>global-0</ows:Identifier>
        <ScaleDenominator>559082264.0287178</ScaleDenominator>
        <TopLeftCorner>-20037508.342789244 20037508.342789244</TopLeftCorner>
        <TileWidth>256</TileWidth><TileHeight>256</TileHeight>
        <MatrixWidth>1</MatrixWidth><MatrixHeight>1</MatrixHeight>
      </TileMatrix>
    </TileMatrixSet>
  </Contents>
</Capabilities>`;

beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
);
afterEach(() => vi.unstubAllGlobals());

it('creates native WMS tile requests and manages the layer through LayerService', async () => {
  const app = createGISApp().use(createOLAdapter({ tools: false }));
  try {
    await app.init({
      layers: [
        {
          id: 'roads',
          type: 'wms',
          options: { opacity: 0.6 },
          source: {
            url: 'https://example.test/wms',
            params: { LAYERS: 'demo:roads', FORMAT: 'image/png', TRANSPARENT: true },
          },
        },
      ],
    });
    const map = useOLMap(app);
    const layer = map.getLayers().item(0) as TileLayer<TileWMS>;
    const source = layer.getSource()!;
    expect(source).toBeInstanceOf(TileWMS);
    const tile = source.getTileUrlFunction()([0, 0, 0], 1, getProjection('EPSG:3857')!)!;
    expect(Object.fromEntries(new URL(tile).searchParams)).toMatchObject({
      REQUEST: 'GetMap',
      LAYERS: 'demo:roads',
      FORMAT: 'image/png',
      TRANSPARENT: 'true',
    });
    expect(layer.getOpacity()).toBe(0.6);
    const setVisible = vi.spyOn(layer, 'setVisible');
    const setZIndex = vi.spyOn(layer, 'setZIndex');
    await app.layers.update('roads', { visible: false, zIndex: 4, options: { opacity: 0.3 } });
    expect(setVisible).toHaveBeenCalledExactlyOnceWith(false);
    expect(setZIndex).toHaveBeenCalledExactlyOnceWith(4);
    expect(layer.getVisible()).toBe(false);
    expect(layer.getZIndex()).toBe(4);
    expect(layer.getOpacity()).toBe(0.3);
    await app.layers.remove('roads');
    expect(map.getLayers().getLength()).toBe(0);
    expect(layer.getSource()).toBeNull();
    await expect(
      app.layers.add({ id: 'roads', type: 'wms', source: { url: 'https://example.test/wms' } })
    ).rejects.toThrow('source.params.LAYERS');
  } finally {
    await app.dispose();
  }
});

it('restores an OL layer when a setter throws after mutating the engine', async () => {
  const app = createGISApp().use(createOLAdapter({ tools: false }));
  try {
    await app.init({
      layers: [
        {
          id: 'points',
          type: 'geojson',
          title: 'Before',
          style: { fillColor: '#ff0000' },
          source: { type: 'inline', data: { type: 'FeatureCollection', features: [] } },
        },
      ],
    });
    const layer = useOLMap(app).getLayers().item(0) as VectorLayer;
    const instance = app.layers.get('points')!;
    const before = app.context.state.snapshot().layers;
    const previousStyle = layer.getStyle();
    const failure = new Error('injected failure after setZIndex');
    const setZIndex = layer.setZIndex.bind(layer);
    vi.spyOn(layer, 'setZIndex').mockImplementationOnce((value) => {
      setZIndex(value);
      throw failure;
    });
    const patch = {
      title: 'After',
      visible: false,
      zIndex: 4,
      style: { fillColor: '#0000ff' },
      options: { opacity: 0.3 },
    };
    await expect(app.layers.update('points', patch)).rejects.toBe(failure);
    expect(layer.getStyle()).toBe(previousStyle);
    expect(layer.getZIndex()).toBeUndefined();
    expect(layer.getVisible()).toBe(true);
    expect(layer.getOpacity()).toBe(1);
    expect(instance.style?.fillColor).toBe('#ff0000');
    expect(instance.title).toBe('Before');
    expect(app.context.state.snapshot().layers).toBe(before);
    await app.layers.update('points', patch);
    expect(instance.title).toBe('After');
    expect(instance.version).toBe(1);
  } finally {
    await app.dispose();
  }
});

it('resolves WMTS capabilities and permits retry after HTTP and matrix-set errors', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockImplementation(async () => new Response(capabilities));
  vi.stubGlobal('fetch', fetch);
  const app = createGISApp().use(createOLAdapter({ tools: false }));
  try {
    await app.init({});
    await expect(app.layers.add(wmtsConfig)).rejects.toMatchObject({ code: 'DATA_LOAD_FAILED' });
    expect(app.data.get('wmts-capabilities:base')).toBeUndefined();
    await expect(
      app.layers.add({ ...wmtsConfig, source: { ...wmtsConfig.source, matrixSet: 'missing' } })
    ).rejects.toMatchObject({ code: 'DATA_LOAD_FAILED', detail: { matrixSet: 'missing' } });
    expect(app.data.get('wmts-capabilities:base')).toBeUndefined();

    await app.layers.add(wmtsConfig);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(Array(3).fill(wmtsConfig.source.url));
    expect(app.data.get('wmts-capabilities:base')).toBeUndefined();
    const map = useOLMap(app);
    const source = (map.getLayers().item(0) as TileLayer<WMTS>).getSource()!;
    expect(source).toBeInstanceOf(WMTS);
    const tile = source.getTileUrlFunction()([0, 0, 0], 1, getProjection('EPSG:3857')!)!;
    const params = new Map(
      Array.from(new URL(tile).searchParams, ([key, value]) => [key.toUpperCase(), value])
    );
    expect(Object.fromEntries(params)).toMatchObject({
      REQUEST: 'GetTile',
      LAYER: 'basemap',
      TILEMATRIXSET: 'web-mercator',
      TILEMATRIX: 'global-0',
    });
    await app.layers.remove('base');
    expect(map.getLayers().getLength()).toBe(0);
  } finally {
    await app.dispose();
  }
});

it('aborts a pending WMTS capabilities request when the app is disposed', async () => {
  let requestStarted!: (signal: AbortSignal) => void;
  const started = new Promise<AbortSignal>((resolve) => {
    requestStarted = resolve;
  });
  vi.stubGlobal(
    'fetch',
    (_url: string, { signal }: { signal: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        requestStarted(signal);
      })
  );
  const app = createGISApp().use(createOLAdapter({ tools: false }));
  try {
    await app.init({});
    const adding = expect(app.layers.add(wmtsConfig)).rejects.toMatchObject({
      code: 'DATA_LOAD_FAILED',
    });
    const signal = await started;
    await app.dispose();
    await adding;
    expect(signal.aborted).toBe(true);
    expect(app.data.get('wmts-capabilities:base')).toBeUndefined();
  } finally {
    await app.dispose();
  }
});
