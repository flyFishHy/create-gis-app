import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import Polygon from 'ol/geom/Polygon.js';
import MultiPoint from 'ol/geom/MultiPoint.js';
import Draw from 'ol/interaction/Draw.js';
import Modify from 'ol/interaction/Modify.js';
import Snap from 'ol/interaction/Snap.js';
import Point from 'ol/geom/Point.js';
import View from 'ol/View.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import TileLayer from 'ol/layer/Tile.js';
import CircleStyle from 'ol/style/Circle.js';
import { createGISApp } from '@joinmap/gis-core';
import { createOLAdapter, createOLLayerHandle, useOLMap, useOLTools } from '../src/index.js';

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
const collection = { type: 'FeatureCollection', features: [] };

it('keeps a shared external source intact when a custom layer is removed', async () => {
  const feature = new Feature(new Point([1, 2]));
  const source = new VectorSource({ features: [feature] });
  const app = createGISApp().use(createOLAdapter({ tools: false }));
  app.use({
    name: 'shared-source-layer',
    install(runtime, _options, resources) {
      runtime.registerLayerType(
        'custom-vector',
        {
          create: (context, config) =>
            createOLLayerHandle(context, new VectorLayer({ source }), config),
        },
        resources
      );
    },
  });
  try {
    await app.init({
      layers: [
        { id: 'first', type: 'custom-vector' },
        { id: 'second', type: 'custom-vector' },
      ],
    });
    const map = useOLMap(app);
    const remaining = map.getLayers().item(1);
    await app.layers.remove('first');
    expect(map.getLayers().getArray()).toEqual([remaining]);
    expect(source.getFeatures()).toEqual([feature]);
  } finally {
    await app.dispose();
  }
  expect(source.getFeatures()).toEqual([feature]);
});

it('does not adopt or dispose a replacement dataset with the same ID as a tool target', async () => {
  const app = createGISApp().use(createOLAdapter());
  try {
    await app.init({
      tools: { draw: { targets: { point: 'points' } } },
      layers: [{ id: 'points', type: 'geojson', source: { type: 'inline', data: collection } }],
    });
    const id = 'layer:points';
    await app.data.remove(id);
    const replacement = await app.data.load({ id, type: 'inline', data: collection });
    await expect(app.interactions.activateTool('draw-point')).rejects.toThrow(
      'requires a writable inline GeoJSON layer "points"'
    );
    await app.layers.remove('points');
    expect(app.data.get(id)).toBe(replacement);
    expect(replacement.status).toBe('ready');

    await expect(
      app.layers.add({
        id: 'points',
        type: 'geojson',
        source: { type: 'inline', data: collection },
      })
    ).rejects.toMatchObject({ code: 'DATASET_DUPLICATE' });
    expect(app.data.get(id)).toBe(replacement);
  } finally {
    await app.dispose();
  }
});

it('does not write to or clear a replacement source on a managed GeoJSON layer', async () => {
  const app = createGISApp().use(createOLAdapter());
  const feature = new Feature(new Point([1, 2]));
  const replacement = new VectorSource({ features: [feature] });
  try {
    await app.init({
      tools: { draw: { targets: { point: 'points' } } },
      layers: [{ id: 'points', type: 'geojson', source: { type: 'inline', data: collection } }],
    });
    const layer = useOLMap(app).getLayers().item(0) as VectorLayer<VectorSource>;
    layer.setSource(replacement);
    await expect(app.interactions.activateTool('draw-point')).rejects.toThrow(
      'requires a writable inline GeoJSON layer "points"'
    );
    await app.layers.remove('points');
    expect(app.data.get('layer:points')).toBeUndefined();
    expect(replacement.getFeatures()).toEqual([feature]);
  } finally {
    await app.dispose();
  }
});

it('highlights the exact GeoJSON selection and releases it when its data or filters change', async () => {
  const attachedLayers = vi.spyOn(VectorLayer.prototype, 'setMap');
  const app = createGISApp().use(createOLAdapter({ tools: false }));
  const data = {
    ...collection,
    features: [1, 2].map((value) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [value, value] },
      properties: { name: 'Station', category: value, observed_at: `2026-11-0${value}` },
    })),
  };
  await app.init({
    layers: [
      {
        id: 'points',
        type: 'geojson',
        source: { type: 'inline', data },
        legend: {
          type: 'category',
          field: 'category',
          items: [{ id: 'first', values: [1], label: 'First', color: '#333333' }],
        },
      },
    ],
  });
  try {
    const map = useOLMap(app);
    const layer = map.getLayers().item(0) as VectorLayer<VectorSource<Feature<Point>>>;
    const highlight = attachedLayers.mock.contexts.find(
      (item) => item !== layer
    ) as VectorLayer<VectorSource>;
    const marker = highlight.getSource()!.getFeatures()[0]!;
    const [first, second] = layer.getSource()!.getFeatures() as [Feature<Point>, Feature<Point>];
    const baseStyle = first.getStyle();
    const layerInstance = app.layers.get('points')!;
    vi.spyOn(map, 'forEachFeatureAtPixel').mockImplementation((_pixel, callback, options) => {
      expect(options?.layerFilter?.(highlight)).toBe(false);
      return callback(first, layer, first.getGeometry()!);
    });
    map.dispatchEvent({ type: 'singleclick', pixel: [0, 0] } as never);
    const [firstMatch, secondMatch] = await app.search.search({
      keyword: 'Station',
      layerId: 'points',
    });
    expect(app.interactions.getSelection()).toEqual(firstMatch?.feature);
    expect(firstMatch?.feature?.featureKey).not.toBe(secondMatch?.feature?.featureKey);
    expect((marker.getGeometry() as Point).getCoordinates()).toEqual(
      first.getGeometry()!.getCoordinates()
    );
    expect(marker.getGeometry()).not.toBe(first.getGeometry());
    expect(first.getStyle()).toBe(baseStyle);
    expect(map.getLayers().getLength()).toBe(1);

    const selected = secondMatch!.feature!;
    const selectSecond = () => app.interactions.select({ feature: selected });
    selectSecond();
    expect((marker.getGeometry() as Point).getCoordinates()).toEqual(
      second.getGeometry()!.getCoordinates()
    );
    second.getGeometry()!.setCoordinates([42, 72]);
    expect((marker.getGeometry() as Point).getCoordinates()).toEqual([42, 72]);
    layerInstance.setLegendFilter('first');
    expect(app.interactions.getSelection()).toBeUndefined();
    expect(marker.getGeometry()).toBeUndefined();
    layerInstance.setLegendFilter(undefined);

    selectSecond();
    const earliest = layerInstance.getTimeDimensions()[0]!.values[0]!;
    layerInstance.setTimeFilter({ field: 'observed_at', start: earliest, end: earliest });
    expect(app.interactions.getSelection()).toBeUndefined();
    expect(marker.getGeometry()).toBeUndefined();
    layerInstance.setTimeFilter(undefined);

    selectSecond();
    app.data.get('layer:points')!.update(data);
    selectSecond();
    expect(app.interactions.getSelection()).toBeUndefined();
    expect(marker.getGeometry()).toBeUndefined();
    const [current] = await app.search.search({ keyword: 'Station', layerId: 'points' });
    app.interactions.select({ feature: current!.feature! });
    expect(marker.getGeometry()).toBeDefined();
    app.layers.setVisibility('points', false);
    expect(marker.getGeometry()).toBeUndefined();
  } finally {
    await app.dispose();
  }
});

it('hosts a coordinate popup in an OL overlay and keeps it inside the viewport without panning', async () => {
  const app = createGISApp().use(createOLAdapter({ tools: false }));
  await app.init({ map: { center: [0, 0], zoom: 5 } });
  try {
    const map = useOLMap(app);
    const container = map.getOverlayContainerStopEvent()!;
    const element = document.createElement('div');
    Object.defineProperties(element, { offsetWidth: { value: 100 }, offsetHeight: { value: 60 } });
    vi.spyOn(map, 'getSize').mockReturnValue([300, 200]);
    const pixel = vi.spyOn(map, 'getPixelFromCoordinate').mockReturnValue([290, 190]);
    const release = app.map.addPopupOverlay(element, { coordinate: [10, 15] })!;
    const overlay = map.getOverlays().item(0)!;
    expect(overlay.getPosition()).toEqual([10, 15]);
    expect(overlay.getOffset()).toEqual([-98, -70]);
    expect(element.dataset.popupTail).toBe('bottom');
    expect(element.style.getPropertyValue('--gis-ui-map-popup-anchor-x')).toBe('98px');
    expect(container.contains(element)).toBe(true);
    expect(map.getView().getCenter()).toEqual([0, 0]);

    pixel.mockReturnValue([20, 20]);
    map.dispatchEvent('postrender');
    expect(overlay.getOffset()).toEqual([-12, 10]);
    expect(element.dataset.popupTail).toBe('top');
    expect(element.style.getPropertyValue('--gis-ui-map-popup-anchor-x')).toBe('12px');
    pixel.mockReturnValue([-2, 20]);
    map.dispatchEvent('postrender');
    expect(element.style.visibility).toBe('hidden');
    release();
    release();
    expect(map.getOverlays().getLength()).toBe(0);
    expect(container.contains(element)).toBe(false);
  } finally {
    await app.dispose();
  }
});

it('collects map hits once and queries a custom tile layer in the same click', async () => {
  const app = createGISApp();
  const identify = vi.fn(async () => [{ id: 'height', properties: { height: 132 } }]);
  app.use(createOLAdapter({ tools: false }));
  app.use({
    name: 'identify-tile',
    install(runtime, _options, scope) {
      runtime.registerLayerType(
        'identify-tile',
        {
          create(context, config) {
            const handle = createOLLayerHandle(context, new TileLayer(), config);
            handle.identify = identify;
            return handle;
          },
        },
        scope
      );
    },
  });
  await app.init({
    map: { center: [0, 0], zoom: 5, projection: 'EPSG:3857' },
    layers: [
      {
        id: 'points',
        type: 'geojson',
        source: {
          type: 'inline',
          data: {
            ...collection,
            features: [
              {
                type: 'Feature',
                id: 'station',
                geometry: { type: 'Point', coordinates: [0, 0] },
                properties: { name: 'Station' },
              },
            ],
          },
        },
      },
      { id: 'terrain', type: 'identify-tile', zIndex: 1 },
      { id: 'hidden', type: 'identify-tile', visible: false, zIndex: 2 },
    ],
  });
  try {
    const map = useOLMap(app);
    const layer = map.getLayers().item(0) as VectorLayer<VectorSource>;
    const feature = layer.getSource()!.getFeatures()[0]!;
    const geometry = feature.getGeometry() as Point;
    const hit = vi.spyOn(map, 'forEachFeatureAtPixel').mockImplementation((_pixel, callback) => {
      callback(feature, layer, geometry);
      callback(feature, layer, geometry);
    });
    const renderer = vi.fn();
    app.interactions.registerFeaturePicker(renderer);
    map.dispatchEvent({ type: 'singleclick', pixel: [12, 20], coordinate: [0, 0] } as never);
    await vi.waitFor(() =>
      expect(renderer).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: 'choices',
          candidates: [
            expect.objectContaining({ layerId: 'terrain', id: 'height' }),
            expect.objectContaining({ layerId: 'points', id: 'station' }),
          ],
        })
      )
    );
    expect(hit).toHaveBeenCalledOnce();
    expect(identify).toHaveBeenCalledOnce();
    expect(identify).toHaveBeenCalledWith(
      expect.objectContaining({ pixel: [12, 20], coordinate: [0, 0], projection: 'EPSG:3857' })
    );
  } finally {
    await app.dispose();
  }
});

it('renders typed categories and half-open intervals from the same legend rules as the UI', async () => {
  const app = createGISApp();
  app.use(createOLAdapter({ tools: false, controls: false, interactions: false }));
  const data = {
    type: 'FeatureCollection',
    features: [0, 100, 200, null, '100'].map((value, id) => ({
      type: 'Feature',
      id,
      properties: { value },
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    })),
  };
  await app.init({
    layers: [
      {
        id: 'rules',
        type: 'geojson',
        source: { type: 'inline', data },
        style: { strokeColor: '#888888', strokeWidth: 3 },
        legend: {
          type: 'interval',
          field: 'value',
          ranges: [
            { id: 'a', min: 0, max: 100, color: '#ff0000' },
            { id: 'b', min: 100, max: 200, color: '#00ff00' },
          ],
        },
      },
    ],
  });
  try {
    const layer = useOLMap(app).getLayers().item(0) as VectorLayer<VectorSource>;
    const features = layer.getSource()!.getFeatures();
    const style = (index: number) => {
      const result = layer.getStyleFunction()!(features[index]!, 1);
      return Array.isArray(result) ? result[0]! : (result as import('ol/style/Style.js').default);
    };
    const color = (index: number) => style(index).getStroke()!.getColor();
    expect(features.map((_, index) => color(index))).toEqual([
      '#ff0000',
      '#00ff00',
      '#888888',
      '#888888',
      '#888888',
    ]);
    await app.layers.update('rules', {
      legend: {
        type: 'category',
        field: 'value',
        items: [
          { id: 'number', values: [100, 200], label: 'Number', color: '#0000ff' },
          { id: 'string', value: '100', label: 'String', color: '#ffff00' },
        ],
      },
    });
    expect(color(1)).toBe('#0000ff');
    expect(color(2)).toBe('#0000ff');
    expect(color(4)).toBe('#ffff00');
    expect(app.layers.get('rules')!.getFieldValues('value')).toEqual([0, 100, 200, '100']);
    expect(Object.isFrozen(app.layers.get('rules')!.getFieldValues('value'))).toBe(true);
    await app.layers.update('rules', {
      style: {
        fillColor: '#ff00ff',
        fillOpacity: 0.5,
        strokeColor: '#111111',
        strokeWidth: 5,
        lineDash: 'dashed',
        lineCap: 'butt',
      },
    });
    expect(color(0)).toBe('#111111');
    expect(color(1)).toBe('#0000ff');
    expect(style(1).getStroke()!.getLineDash()).toEqual([8, 5]);
    expect(style(1).getStroke()!.getLineCap()).toBe('butt');
    expect(style(1).getFill()!.getColor()).toEqual([255, 0, 255, 0.5]);
    const before = app.layers.get('rules')!.version;
    await expect(
      app.layers.update('rules', { options: { opacity: 0.2 }, style: { strokeWidth: -1 } })
    ).rejects.toThrow();
    expect(layer.getOpacity()).toBe(1);
    expect(app.layers.get('rules')!.version).toBe(before);
    expect(app.context.state.snapshot().layers[0]?.style?.strokeWidth).toBe(5);
    await app.layers.update('rules', { legend: null });
    expect(color(1)).toBe('#111111');
    await expect(
      app.layers.add({
        id: 'tiles',
        type: 'xyz',
        source: { url: '/tiles/{z}/{x}/{y}.png' },
        legend: { type: 'category', field: 'value', items: [] },
      })
    ).rejects.toThrow();
  } finally {
    await app.dispose();
  }
});

it('reads live typed field values independently of visibility and preserves grouped matches after data updates', async () => {
  const app = createGISApp();
  app.use(createOLAdapter({ tools: false, controls: false, interactions: false }));
  const data = (values: (string | number | boolean | null)[]) => ({
    type: 'FeatureCollection',
    features: values.map((value) => ({
      type: 'Feature',
      properties: { kind: value },
      geometry: { type: 'Point', coordinates: [0, 0] },
    })),
  });
  await app.init({
    layers: [
      {
        id: 'values',
        type: 'geojson',
        source: { type: 'inline', data: data(['urban', 'suburban', 'urban', false, 0, '0', null]) },
        legend: {
          type: 'category',
          field: 'kind',
          items: [
            { id: 'cities', label: 'Cities', values: ['urban', 'suburban'], color: '#123456' },
          ],
        },
      },
    ],
  });
  try {
    const layer = app.layers.get('values')!;
    expect(layer.getFieldValues('kind')).toEqual(['urban', 'suburban', false, 0, '0']);
    app.layers.setVisibility('values', false);
    expect(layer.getFieldValues('kind')).toContain('suburban');
    app.data.get('layer:values')!.update(data(['new', 'suburban']));
    expect(layer.getFieldValues('kind')).toEqual(['new', 'suburban']);
    expect(app.context.state.snapshot().layers[0]?.legend?.items?.[0]?.values).toEqual([
      'urban',
      'suburban',
    ]);
    expect(app.context.state.snapshot().layers[0]?.metadata).not.toHaveProperty('fieldValues');
    const vector = useOLMap(app).getLayers().item(0) as VectorLayer<VectorSource>;
    const styles = vector.getStyleFunction()!(vector.getSource()!.getFeatures()[1]!, 1);
    const style = Array.isArray(styles)
      ? styles[0]!
      : (styles as import('ol/style/Style.js').default);
    expect(style.getFill()!.getColor()).toBe('#123456');
  } finally {
    await app.dispose();
  }
});

it('locates current GeoJSON data, merges groups, handles points and preserves correct projection after view replacement', async () => {
  const app = createGISApp();
  app.use(createOLAdapter({ tools: false, controls: false, interactions: false }));
  const point = (coordinate: [number, number]) => ({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coordinate } },
    ],
  });
  try {
    await app.init({
      map: { center: [0, 0], zoom: 4 },
      layers: [
        {
          id: 'group',
          type: 'GROUP',
          children: [
            {
              id: 'a',
              type: 'geojson',
              zIndex: 100,
              source: { type: 'inline', data: point([10, 20]) },
            },
            {
              id: 'b',
              type: 'geojson',
              zIndex: -10,
              source: { type: 'inline', data: point([30, 40]) },
            },
          ],
        },
      ],
    });
    const first = app.layers.getDataLocation('a')!;
    expect(first.coordinate?.[0]).toBeCloseTo(1113194.9079, 2);
    app.map.locate(first);
    expect(app.map.getView().getZoom()).toBe(4);
    expect(app.layers.getDataLocation('group')?.extent?.[2]).toBeCloseTo(3339584.7238, 2);
    app.data.get('layer:a')!.update(point([-10, -20]));
    expect(app.layers.getDataLocation('a')?.coordinate?.[0]).toBeCloseTo(-1113194.9079, 2);
    useOLMap(app).setView(new View({ projection: 'EPSG:4326', center: [0, 0], zoom: 2 }));
    expect(app.layers.getDataLocation('a')).toMatchObject({ projection: 'EPSG:4326' });
    expect(app.layers.getDataLocation('a')?.coordinate?.[0]).toBeCloseTo(-10, 5);
    app.layers.setOrder(['a', 'b', 'group']);
    expect(app.layers.get('b')!.getMetadata().zIndex).toBe(1);
    expect(app.layers.get('a')!.getMetadata().zIndex).toBe(0);
    app.data.get('layer:a')!.update(collection);
    app.data.get('layer:b')!.update(collection);
    expect(app.layers.getDataLocation('group')).toBeUndefined();
  } finally {
    await app.dispose();
  }
});

it('searches GeoJSON attributes per layer, refreshes results with data and releases owned providers', async () => {
  const app = createGISApp();
  app.use(createOLAdapter({ tools: false, controls: false, interactions: false }));
  const data = (name: string) => ({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 1,
        properties: { name, count: 42, active: false, details: { label: 'nested-only' } },
        geometry: { type: 'Point', coordinates: [10, 20] },
      },
    ],
  });
  try {
    await app.init({
      map: { projection: 'EPSG:3857', center: [0, 0], zoom: 2 },
      layers: [
        {
          id: 'a',
          title: 'Places A',
          type: 'geojson',
          source: { type: 'inline', data: data('Alpha') },
        },
        {
          id: 'b',
          title: 'Places B',
          type: 'geojson',
          source: { type: 'inline', data: data('Alpha B') },
        },
      ],
    });
    const vector = useOLMap(app).getLayers().item(0) as VectorLayer<VectorSource>;
    const feature = vector.getSource()!.getFeatures()[0]!;
    const copyProperties = vi.spyOn(feature, 'getProperties');
    expect(await app.search.search({ keyword: 'nested-only', layerId: 'a' })).toEqual([]);
    expect(copyProperties).not.toHaveBeenCalled();

    const results = await app.search.search({ keyword: '  ALPHA  ', layerId: 'a' });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      layerId: 'a',
      title: 'Alpha',
      subtitle: 'Places A',
      projection: 'EPSG:3857',
    });
    app.map.locate(results[0]!);
    expect(app.map.getView().getCenter()?.[0]).toBeCloseTo(1113194.9079, 2);
    expect(await app.search.search({ keyword: '42', layerId: 'a' })).toHaveLength(1);
    expect(await app.search.search({ keyword: 'FALSE', layerId: 'a' })).toHaveLength(1);
    expect(await app.search.search({ keyword: '1', layerId: 'a' })).toMatchObject([
      { id: 'a:1', title: 'Alpha' },
    ]);
    feature.set('name', 'Edited');
    expect(await app.search.search({ keyword: 'Edited', layerId: 'a' })).toHaveLength(1);
    feature.unset('name');
    expect(await app.search.search({ keyword: '42', layerId: 'a' })).toMatchObject([
      { title: '42' },
    ]);
    await app.data.get('layer:a')!.update(data('Updated'));
    expect(await app.search.search({ keyword: 'Alpha', layerId: 'a' })).toEqual([]);
    expect((await app.search.search({ keyword: 'Updated', layerId: 'a' }))[0]?.title).toBe(
      'Updated'
    );
    await app.layers.remove('a');
    expect(app.search.listProviders().map((provider) => provider.layerIds)).toEqual([['b']]);
    expect(await app.search.search({ keyword: 'Updated', layerId: 'a' })).toEqual([]);
  } finally {
    await app.dispose();
  }
  expect(app.search.listProviders()).toEqual([]);
});

it('derives date/time dimensions from GeoJSON properties and filters rendered and searched features', async () => {
  const app = createGISApp();
  app.use(createOLAdapter({ tools: false, controls: false, interactions: false }));
  const data = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'old',
        properties: { name: 'Old event', observed_at: '2024-01-01T10:30:00Z' },
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
      {
        type: 'Feature',
        id: 'new',
        properties: { name: 'New event', observed_at: '2024-02-01T10:30:00Z' },
        geometry: { type: 'Point', coordinates: [1, 1] },
      },
    ],
  };
  await app.init({
    layers: [{ id: 'events', title: 'Events', type: 'geojson', source: { type: 'inline', data } }],
  });
  try {
    const instance = app.layers.get('events')!;
    const values = instance
      .getTimeDimensions()
      .find((item) => item.field === 'observed_at')?.values;
    expect(values).toEqual([
      Date.parse('2024-01-01T10:30:00Z'),
      Date.parse('2024-02-01T10:30:00Z'),
    ]);
    const current = values![1]!;
    instance.setTimeFilter({ field: 'observed_at', start: current, end: current });
    const layer = useOLMap(app).getLayers().item(0) as VectorLayer<VectorSource>;
    const style = layer.getStyleFunction()!;
    const [oldFeature, newFeature] = layer.getSource()!.getFeatures();
    expect(style(oldFeature!, 1)).toBeUndefined();
    expect(style(newFeature!, 1)).toBeDefined();
    expect(await app.search.search({ keyword: 'event', layerId: 'events' })).toMatchObject([
      { id: 'events:new' },
    ]);
    expect(instance.getMetadata().time).toMatchObject({
      filter: { field: 'observed_at', start: current, end: current },
    });
    instance.setTimeFilter(undefined);
    expect(await app.search.search({ keyword: 'event', layerId: 'events' })).toHaveLength(2);
    instance.setTimeFilter({ field: 'observed_at', start: current, end: current });
    const errors = vi.fn();
    app.events.on('app:error', errors);
    app.data.get('layer:events')!.update({
      ...data,
      features: data.features.map((feature) => ({
        ...feature,
        properties: { name: feature.properties.name },
      })),
    });
    expect(instance.getTimeFilter()).toBeUndefined();
    expect(app.context.state.snapshot().layers[0]?.metadata.time).toMatchObject({
      dimensions: [],
      filter: null,
    });
    expect(await app.search.search({ keyword: 'event', layerId: 'events' })).toHaveLength(2);
    expect(errors).not.toHaveBeenCalled();
  } finally {
    await app.dispose();
  }
});

it('composes legend rules with time filtering and removes a stale rule on legend replacement', async () => {
  const app = createGISApp().use(
    createOLAdapter({ tools: false, controls: false, interactions: false })
  );
  const data = {
    type: 'FeatureCollection',
    features: [1, 2, 3].map((value) => ({
      type: 'Feature',
      id: value,
      properties: { name: `Site ${value}`, population: value, observed_at: `2024-01-0${value}` },
      geometry: { type: 'Point', coordinates: [value, value] },
    })),
  };
  await app.init({
    layers: [
      {
        id: 'sites',
        type: 'geojson',
        source: { type: 'inline', data },
        legend: {
          type: 'interval',
          field: 'population',
          ranges: [
            { id: 'low', min: 0, max: 2, color: '#111111' },
            { id: 'high', min: 2, max: 3, includeMax: true, color: '#333333' },
          ],
        },
      },
    ],
  });
  try {
    const layer = app.layers.get('sites')!;
    expect(layer.supportsLegendFilter()).toBe(true);
    layer.setLegendFilter('high');
    const vector = useOLMap(app).getLayers().item(0) as VectorLayer<VectorSource>;
    const [low, high] = vector.getSource()!.getFeatures();
    expect(vector.getStyleFunction()!(low!, 1)).toBeUndefined();
    expect(vector.getStyleFunction()!(high!, 1)).toBeDefined();
    expect(await app.search.search({ keyword: 'site' })).toHaveLength(2);
    const time = layer.getTimeDimensions()[0]!.values[1]!;
    layer.setTimeFilter({ field: 'observed_at', start: time, end: time });
    expect(await app.search.search({ keyword: 'site' })).toMatchObject([{ title: 'Site 2' }]);
    await app.layers.update('sites', { legend: null });
    expect(layer.getLegendFilter()).toBeUndefined();
    expect(layer.supportsLegendFilter()).toBe(false);
  } finally {
    await app.dispose();
  }
});

it('edits only the selected result, keeps snapping active and commits the new geometry', async () => {
  const app = createGISApp().use(createOLAdapter());
  await app.init({});
  try {
    const tools = useOLTools(app),
      map = useOLMap(app);
    await tools.importResults(
      ['one', 'two'].map((id, index) => ({
        id,
        toolId: 'draw-point',
        projection: 'EPSG:3857',
        geometry: { type: 'Point', coordinates: [index, index] },
      }))
    );
    tools.select('one');
    await app.interactions.activateTool('modify-result');
    const interactions = map.getInteractions().getArray();
    const modify = interactions.find((interaction) => interaction instanceof Modify)!;
    expect(interactions.at(-1)).toBeInstanceOf(Snap);
    const source = (
      map
        .getLayers()
        .getArray()
        .find(
          (layer) => layer.get('gisLayerId') === 'ol-tools:draw-point'
        ) as VectorLayer<VectorSource>
    ).getSource()!;
    const one = source.getFeatureById('one')!;
    modify.dispatchEvent('modifystart');
    (one.getGeometry() as Point).setCoordinates([3, 4]);
    modify.dispatchEvent('modifyend');
    expect(tools.get('one')?.geometry.coordinates).toEqual([expect.closeTo(3), expect.closeTo(4)]);
    expect(tools.get('two')?.geometry.coordinates).toEqual([expect.closeTo(1), expect.closeTo(1)]);
    await app.interactions.deactivateTool();
    expect(
      interactions.some(
        (interaction) => interaction instanceof Snap || interaction instanceof Modify
      )
    ).toBe(false);
  } finally {
    await app.dispose();
  }
});

it('resolves layer legend styles without Vue and transforms search coordinates to the current projection', async () => {
  const app = createGISApp();
  app.use(createOLAdapter({ controls: false, interactions: false }));
  await app.init({
    map: { projection: 'EPSG:3857', center: [0, 0], zoom: 2 },
    layers: [
      {
        id: 'styled',
        type: 'geojson',
        source: { type: 'inline', data: collection },
        style: { fillColor: '#ff0000' },
        legend: {
          type: 'category',
          useLayerStyle: true,
          items: [{ id: 'one', label: 'One', symbol: 'fill', color: '#0000ff' }],
        },
      },
    ],
  });
  try {
    expect(app.layers.get('styled')?.legend?.items?.[0]?.color).toBe('#ff0000');
    const old = app.context.state.snapshot();
    await app.layers.update('styled', { style: { fillColor: '#00ff00' } });
    expect(app.context.state.snapshot().layers[0]?.legend?.items?.[0]?.color).toBe('#00ff00');
    expect(old.layers[0]?.legend?.items?.[0]?.color).toBe('#ff0000');
    await app.layers.update('styled', {
      legend: {
        type: 'category',
        useLayerStyle: true,
        items: [
          { id: 'a', label: 'A', color: '#ff0000' },
          { id: 'b', label: 'B', color: '#0000ff' },
        ],
      },
    });
    expect(app.layers.get('styled')?.legend?.items?.map((item) => item.color)).toEqual([
      '#ff0000',
      '#0000ff',
    ]);
    app.map.locate({ projection: 'EPSG:4326', coordinate: [10, 20] });
    expect(app.map.getView().getCenter()?.[0]).toBeCloseTo(1113194.9079, 2);
    expect(app.map.getView().getCenter()?.[1]).toBeCloseTo(2273030.927, 2);
  } finally {
    await app.dispose();
  }
});

it('unifies map picks, result selection, business selection and removal', async () => {
  const app = createGISApp();
  app.use(createOLAdapter({ controls: false, interactions: false }));
  await app.init({
    map: { center: [0, 0], zoom: 2 },
    layers: [{ id: 'vector', type: 'geojson', source: { type: 'inline', data: collection } }],
  });
  try {
    const tools = useOLTools(app),
      map = useOLMap(app);
    await tools.importResults([
      {
        id: 'result',
        toolId: 'draw-point',
        projection: 'EPSG:3857',
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
      {
        id: 'distance',
        toolId: 'measure-distance',
        projection: 'EPSG:3857',
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [100, 0],
          ],
        },
      },
    ]);
    const drawing = map
      .getLayers()
      .getArray()
      .find(
        (layer) => layer.get('gisLayerId') === 'ol-tools:draw-point'
      ) as VectorLayer<VectorSource>;
    const distance = map
      .getLayers()
      .getArray()
      .find(
        (layer) => layer.get('gisLayerId') === 'ol-tools:measure-distance'
      ) as VectorLayer<VectorSource>;
    const measurement = distance.getSource()!.getFeatureById('distance')!;
    const hits = vi.spyOn(map, 'forEachFeatureAtPixel');
    hits.mockImplementation((_pixel, callback) => callback(measurement, distance, null as never));
    map.dispatchEvent({ type: 'singleclick', pixel: [0, 0] } as never);
    expect(app.interactions.getSelection()).toMatchObject({
      layerId: 'ol-tools:measure-distance',
      id: 'distance',
      properties: { gisToolId: 'measure-distance', unit: 'm' },
    });
    expect(tools.selected()).toBe('distance');
    app.layers.setVisibility('ol-tools:measure', false);
    expect(app.interactions.getSelection()).toBeUndefined();
    expect(map.getOverlays().getLength()).toBe(0);
    app.layers.setVisibility('ol-tools:measure', true);
    expect(map.getOverlays().getLength()).toBe(2);
    hits.mockImplementation((_pixel, callback) =>
      callback(drawing.getSource()!.getFeatureById('result')!, drawing, null as never)
    );
    map.dispatchEvent({ type: 'singleclick', pixel: [0, 0] } as never);
    expect(tools.selected()).toBe('result');
    expect(app.interactions.getSelection()).toMatchObject({
      layerId: 'ol-tools:draw-point',
      id: 'result',
      properties: { gisToolId: 'draw-point' },
    });
    app.layers.setVisibility('vector', false);
    expect(tools.selected()).toBe('result');
    app.interactions.select({ feature: { layerId: 'vector', id: 'business' } });
    expect(tools.selected()).toBeUndefined();
    tools.select('result');
    expect(app.interactions.getSelection()?.id).toBe('result');
    tools.select('distance');
    expect(app.interactions.getSelection()?.id).toBe('distance');
    tools.remove('distance');
    expect(app.interactions.getSelection()).toBeUndefined();
    expect(tools.selected()).toBeUndefined();
  } finally {
    await app.dispose();
  }
});

it('refreshes GeoJSON data, bridges picks, invalidates hidden selections, and disposes OL', async () => {
  const app = createGISApp();
  app.use(createOLAdapter({ controls: false, interactions: false }));
  await app.init({
    layers: [{ id: 'vector', type: 'geojson', source: { type: 'inline', data: collection } }],
  });
  const map = useOLMap(app);
  try {
    const original = app.context.state.snapshot();
    map.getView().setCenter([100, 200]);
    map.getView().setZoom(5);
    map.getView().setRotation(0.5);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(app.context.state.snapshot().map).toMatchObject({
      ready: true,
      projection: 'EPSG:3857',
      center: [100, 200],
      zoom: 5,
      rotation: 0.5,
    });
    expect(app.context.state.snapshot().revision).toBeGreaterThan(original.revision);
    map.setView(new View({ projection: 'EPSG:4326', center: [10, 20], zoom: 4 }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(app.context.state.snapshot().map).toMatchObject({
      projection: 'EPSG:4326',
      center: [10, 20],
      zoom: 4,
    });
    const layer = map.getLayers().item(0) as VectorLayer<VectorSource>;
    app.data.get('layer:vector')!.update({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'one',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: { title: 'One' },
        },
      ],
    });
    expect(layer.getSource()!.getFeatures()).toHaveLength(1);
    await app.layers.update('vector', {
      options: { opacity: 0.4 },
      style: { fillColor: '#ff0000', strokeColor: '#000000', strokeWidth: 2 },
    });
    expect(layer.getOpacity()).toBe(0.4);
    expect(app.layers.get('vector')!.style).toMatchObject({ fillColor: '#ff0000' });
    await expect(
      app.layers.update('vector', { options: { opacity: 0.9, unknown: true } })
    ).rejects.toThrow();
    expect(layer.getOpacity()).toBe(0.4);
    const previous = app.data.get('layer:vector')!.data;
    expect(() => app.data.get('layer:vector')!.update({ type: 'invalid' })).toThrow();
    expect(app.data.get('layer:vector')!.data).toBe(previous);
    expect(layer.getSource()!.getFeatures()).toHaveLength(1);
    vi.spyOn(map, 'forEachFeatureAtPixel').mockImplementation((_pixel, callback) =>
      callback(layer.getSource()!.getFeatures()[0]!, layer, null as never)
    );
    map.dispatchEvent({ type: 'singleclick', pixel: [0, 0] } as never);
    expect(app.interactions.getSelection()).toMatchObject({
      layerId: 'vector',
      id: 'one',
      properties: { title: 'One' },
    });
    app.layers.setVisibility('vector', false);
    expect(app.interactions.getSelection()).toBeUndefined();
  } finally {
    await app.dispose();
  }
  expect(map.getLayers().getLength()).toBe(0);
});

it('runs real drawing interactions through Core, preserves sketches on sorting, and calculates angles', async () => {
  const app = createGISApp();
  app.use(createOLAdapter({ controls: false, interactions: false }));
  await app.init({
    map: { projection: 'EPSG:4326', center: [0, 0], zoom: 2 },
    layers: [{ id: 'vector', type: 'geojson', source: { type: 'inline', data: collection } }],
  });
  const map = useOLMap(app);
  const host = document.createElement('div');
  const target = document.createElement('div');
  target.style.setProperty('--gis-map-measurement-color', '#08875a');
  host.append(target);
  document.body.append(host);
  map.setTarget(target);
  try {
    await app.interactions.activateTool('measure-angle');
    const draw = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof Draw)!;
    const feature = new Feature(
      new LineString([
        [0, -1],
        [0, 0],
        [-1, 0],
      ])
    );
    draw.dispatchEvent({ type: 'drawend', feature } as never);
    await vi.waitFor(() => expect(useOLTools(app).list()).toHaveLength(1));
    const layer = map.getLayers().getArray().at(-1) as VectorLayer<VectorSource>;
    const committed = layer.getSource()!.getFeatures()[0]!;
    const checkArc = (color: number[]) => {
      const resolution = map.getView().getResolution()!;
      const styles = committed.getStyleFunction()!(committed, resolution);
      if (!Array.isArray(styles)) throw new Error('Missing measurement styles');
      const arc = styles[2]!.getGeometry() as LineString;
      const midpoint = arc.getCoordinateAt(0.5);
      const position = map.getOverlays().item(0).getPosition()!;
      expect(position[0]).toBeCloseTo(position[1]!);
      expect(position[0]).toBeLessThan(midpoint[0]!);
      expect(styles[0]!.getStroke()?.getColor()).toEqual(color);
      expect(styles[2]!.getStroke()?.getColor()).toEqual(color);
      const marker = styles[1]!.getImage() as CircleStyle;
      expect(marker.getFill()?.getColor()).toBe('#fff');
      expect(marker.getStroke()?.getColor()).toEqual(color);
    };
    checkArc([8, 135, 90, 1]);
    target.style.setProperty('--gis-map-measurement-color', '#6944af');
    await Promise.resolve();
    map.getView().setResolution(map.getView().getResolution()! / 2);
    map.dispatchEvent('postrender');
    checkArc([105, 68, 175, 1]);
    const replacement = document.createElement('div');
    host.append(replacement);
    map.setTarget(replacement);
    checkArc([59, 130, 246, 1]);
    replacement.style.setProperty('--gis-map-measurement-color', '#08875a');
    await vi.waitFor(() => checkArc([8, 135, 90, 1]));
    expect(useOLTools(app).list()[0]).toMatchObject({
      value: 90,
      unit: '°',
      projection: 'EPSG:4326',
    });
    expect(app.context.state.snapshot().extensions['ol-tools']).toMatchObject({
      results: [{ value: 90, unit: '°' }],
    });
    const tools = useOLTools(app);
    const result = tools.list()[0]!;
    expect(map.getOverlays().item(0).getElement()?.firstElementChild?.textContent).toBe('90°');
    tools.select(result.id);
    expect(tools.selected()).toBe(result.id);
    expect(app.interactions.getSelection()?.layerId).toBe('ol-tools:measure-angle');
    tools.updateGeometry(result.id, {
      type: 'LineString',
      coordinates: [
        [1, 0],
        [0, 0],
        [1, 1],
      ],
    });
    expect(tools.get(result.id)!.value).toBeCloseTo(45);
    expect(map.getOverlays().item(0).getElement()?.firstElementChild?.textContent).toBe('45°');
    expect(() =>
      tools.updateGeometry(result.id, {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [0, 0],
          [1, 1],
        ],
      })
    ).toThrow();
    expect(tools.get(result.id)!.value).toBeCloseTo(45);
    const saved = tools.exportResults();
    tools.remove(result.id);
    expect(tools.list()).toHaveLength(0);
    expect(map.getOverlays().getLength()).toBe(0);
    await tools.importResults(saved);
    expect(tools.list()).toHaveLength(1);
    expect(map.getOverlays().item(0).getElement()?.firstElementChild?.textContent).toBe('45°');
    await expect(tools.importResults(saved)).rejects.toThrow();
    expect(app.layers.get('ol-tools:measure')?.getMetadata().childIds).toEqual([
      'ol-tools:measure-angle',
    ]);
    app.layers.setOrder(['ol-tools:measure-angle', 'ol-tools:measure', 'vector']);
    expect(map.getLayers().getLength()).toBe(2);
    await app.interactions.activateTool('draw-point');
    expect(map.getInteractions().getArray()).not.toContain(draw);
    await useOLTools(app).cancel();
    expect(useOLTools(app).list()).toHaveLength(1);
    await useOLTools(app).clear();
    expect(useOLTools(app).list()).toHaveLength(0);
  } finally {
    await app.dispose();
    host.remove();
  }
});

it('shows live area and square kilometers without rendering an angle arc', async () => {
  const app = createGISApp().use(createOLAdapter({ controls: false, interactions: false }));
  await app.init({});
  const map = useOLMap(app);
  const overlays = map.getOverlays();
  const ring = [
    [0, 0],
    [40, 40],
    [0, 80],
    [80, 80],
    [80, 0],
    [0, 0],
  ];
  try {
    await app.interactions.activateTool('measure-area');
    expect(app.layers.list()).toHaveLength(0);
    const draw = map
      .getInteractions()
      .getArray()
      .find((item) => item instanceof Draw)!;
    const geometry = new Polygon([]);
    const feature = new Feature(geometry);
    draw.dispatchEvent({ type: 'drawend', feature } as never);
    expect(app.layers.list()).toHaveLength(0);
    draw.dispatchEvent({ type: 'drawstart', feature } as never);
    expect(overlays.getLength()).toBe(0);
    geometry.setCoordinates([ring]);
    expect(overlays.getLength()).toBe(1);
    const preview = overlays.item(0);
    expect(preview.getElement()?.textContent).toMatch(/ m²$/);
    expect(preview.getPosition()).toEqual([80, 0]);
    expect(preview.getOptions().stopEvent).toBe(false);
    draw.dispatchEvent({ type: 'drawabort', feature } as never);
    expect(overlays.getLength()).toBe(0);

    draw.dispatchEvent({ type: 'drawstart', feature } as never);
    draw.dispatchEvent({ type: 'drawend', feature } as never);
    await vi.waitFor(() => expect(overlays.getLength()).toBe(1));
    const [x, y] = geometry.getInteriorPoint().getCoordinates();
    expect(overlays.item(0).getPosition()).toEqual([expect.closeTo(x!), expect.closeTo(y!)]);
    const layer = map
      .getLayers()
      .getArray()
      .find(
        (item) => item.get('gisLayerId') === 'ol-tools:measure-area'
      ) as VectorLayer<VectorSource>;
    const committed = layer.getSource()!.getFeatures()[0]!;
    const styles = committed.getStyleFunction()!(committed, 1);
    expect(Array.isArray(styles)).toBe(true);
    const styleGeometries = Array.isArray(styles)
      ? styles.map((style) => style.getGeometryFunction()(committed))
      : [];
    const vertices = styleGeometries.find((item) => item instanceof MultiPoint);
    expect(vertices?.getCoordinates()).toEqual(
      ring.slice(0, -1).map(([x, y]) => [expect.closeTo(x!), expect.closeTo(y!)])
    );
    expect(styleGeometries.some((item) => item instanceof LineString)).toBe(false);
    const tools = useOLTools(app);
    tools.updateGeometry(tools.list()[0]!.id, {
      type: 'Polygon',
      coordinates: [ring.map(([x, y]) => [x! * 100, y! * 100])],
    });
    expect(overlays.item(0).getElement()?.firstElementChild?.textContent).toMatch(/ km²$/);
  } finally {
    await app.dispose();
  }
  expect(overlays.getLength()).toBe(0);
});

it('labels cumulative distances at nodes and deletes a completed result from its total', async () => {
  const app = createGISApp().use(createOLAdapter({ controls: false, interactions: false }));
  await app.init({});
  const map = useOLMap(app);
  const overlays = map.getOverlays();
  const tools = useOLTools(app);
  try {
    await app.interactions.activateTool('measure-distance');
    const draw = map
      .getInteractions()
      .getArray()
      .find((item) => item instanceof Draw)!;
    const coordinates = [
      [0, 0],
      [700, 0],
      [700, 700],
      [1_400, 700],
    ];
    const geometry = new LineString([coordinates[0]!, coordinates[0]!]);
    const feature = new Feature(geometry);
    draw.dispatchEvent({ type: 'drawstart', feature } as never);
    expect(overlays.getLength()).toBe(2);
    expect(overlays.item(0).getElement()?.textContent).toBe('起点');
    expect(overlays.item(1).getElement()?.textContent).toBe('总长: 0 m');
    geometry.setCoordinates(coordinates);
    expect(overlays.getLength()).toBe(4);
    expect(overlays.getArray().map((item) => item.getPosition())).toEqual(coordinates);
    expect(overlays.item(1).getElement()?.textContent).toMatch(/ m$/);
    expect(overlays.item(2).getElement()?.textContent).toMatch(/^\d.+ km$/);
    expect(overlays.item(3).getElement()?.textContent).toMatch(/^总长: .+ km$/);
    const projected = vi.spyOn(map, 'getPixelFromCoordinate');
    projected.mockImplementation(([x]) => [100 + x! / 10, 100]);
    vi.spyOn(map, 'getSize').mockReturnValue([400, 200]);
    map.dispatchEvent('postrender');
    expect(overlays.item(0).getOffset()[1]).toBeLessThan(0);
    projected.mockImplementation(([x]) => [100 + x! / 10, 2]);
    map.dispatchEvent('postrender');
    expect(overlays.item(0).getOffset()[1]).toBeGreaterThan(0);
    expect(overlays.item(0).getOffset()[1]).toBeLessThan(30);
    expect(overlays.getArray().some((item) => item.getElement()?.querySelector('button'))).toBe(
      false
    );

    draw.dispatchEvent({ type: 'drawend', feature } as never);
    await vi.waitFor(() => expect(app.interactions.getActiveTool()).toBeUndefined());
    expect(map.getInteractions().getArray()).not.toContain(draw);
    expect(overlays.getLength()).toBe(4);
    expect(overlays.item(3).getElement()?.firstElementChild?.textContent).toMatch(
      /^总计: [^\n]+ km$/
    );
    const result = tools.list()[0]!;
    tools.updateGeometry(result.id, { type: 'LineString', coordinates: coordinates.slice(0, 2) });
    expect(overlays.getLength()).toBe(2);
    expect(overlays.item(1).getElement()?.querySelector('button')).toBeTruthy();
    tools.updateGeometry(result.id, { type: 'LineString', coordinates });
    expect(overlays.getLength()).toBe(4);
    const buttons = overlays
      .getArray()
      .flatMap((item) => [...(item.getElement()?.querySelectorAll('button') ?? [])]);
    expect(buttons).toHaveLength(1);
    buttons[0]!.click();
    expect(overlays.getLength()).toBe(0);
    expect(tools.list()).toHaveLength(0);
  } finally {
    await app.dispose();
  }
});

it('creates a default drawing group only after a valid result and publishes the first feature with it', async () => {
  const app = createGISApp().use(createOLAdapter({ controls: false, interactions: false }));
  await app.init({});
  try {
    const map = useOLMap(app);
    await app.interactions.activateTool('draw-line');
    expect(app.layers.list()).toEqual([]);
    const draft = map
      .getInteractions()
      .getArray()
      .find((item) => item instanceof Draw)!;
    draft.appendCoordinates([[0, 0]]);
    await app.interactions.deactivateTool();
    expect(app.layers.list()).toEqual([]);
    await app.interactions.activateTool('draw-line');
    const published: { ids: string[]; count: number }[] = [];
    const unlisten = app.layers.subscribe((event) => {
      if (event.type !== 'add') return;
      const layer = map
        .getLayers()
        .getArray()
        .find(
          (layer) => layer.get('gisLayerId') === 'ol-tools:draw-line'
        ) as VectorLayer<VectorSource>;
      published.push({
        ids: app.layers.list().map(({ id }) => id),
        count: layer.getSource()!.getFeatures().length,
      });
    });
    const draw = map
      .getInteractions()
      .getArray()
      .find((item) => item instanceof Draw)!;
    draw.appendCoordinates([
      [0, 0],
      [100, 100],
    ]);
    draw.finishDrawing();

    await vi.waitFor(() => expect(app.interactions.getActiveTool()).toBeUndefined());
    expect(useOLTools(app).list()).toHaveLength(1);
    expect(published).toEqual(
      Array.from({ length: 2 }, () => ({
        ids: ['ol-tools:draw-line', 'ol-tools:draw'],
        count: 1,
      }))
    );
    unlisten();
    expect(
      map
        .getInteractions()
        .getArray()
        .some((item) => item instanceof Draw || item instanceof Snap)
    ).toBe(false);
  } finally {
    await app.dispose();
  }
});

it('clears a completed result even if its first default layer is still being created', async () => {
  const app = createGISApp().use(createOLAdapter({ controls: false, interactions: false }));
  await app.init({});
  try {
    await app.interactions.activateTool('draw-point');
    const map = useOLMap(app);
    const draw = map
      .getInteractions()
      .getArray()
      .find((item) => item instanceof Draw)!;
    draw.dispatchEvent({ type: 'drawend', feature: new Feature(new Point([1, 2])) } as never);
    await app.interactions.activateTool('clear-results');
    expect(app.layers.has('ol-tools:draw')).toBe(true);
    expect(app.layers.get('ol-tools:draw')?.getMetadata().childIds).toEqual([
      'ol-tools:draw-point',
    ]);
    expect(useOLTools(app).list()).toHaveLength(0);
  } finally {
    await app.dispose();
  }
});

it.each(['draw-first', 'measure-first'])(
  'keeps default tool groups ordered and appends only used types (%s)',
  async (order) => {
    const app = createGISApp().use(createOLAdapter({ controls: false, interactions: false }));
    await app.init({
      layers: [
        {
          id: 'business',
          type: 'geojson',
          zIndex: 100,
          source: { type: 'inline', data: collection },
        },
      ],
    });
    try {
      const tools = useOLTools(app);
      const point = {
        id: 'point',
        toolId: 'draw-point',
        projection: 'EPSG:3857',
        geometry: { type: 'Point', coordinates: [10, 20] },
      };
      const angle = {
        id: 'angle',
        toolId: 'measure-angle',
        projection: 'EPSG:3857',
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 10],
            [0, 0],
            [10, 0],
          ],
        },
      };
      await tools.importResults(order === 'draw-first' ? [point, angle] : [angle, point]);
      const drawing = app.layers.get('ol-tools:draw')!;
      const measuring = app.layers.get('ol-tools:measure')!;
      expect(drawing.getMetadata().childIds).toEqual(['ol-tools:draw-point']);
      expect(measuring.getMetadata().childIds).toEqual(['ol-tools:measure-angle']);
      const zIndex = (id: string) => Number(app.layers.get(id)?.getMetadata().zIndex);
      expect(zIndex('business')).toBe(100);
      expect(zIndex(drawing.id)).toBeGreaterThan(zIndex('business'));
      expect(zIndex(measuring.id)).toBeGreaterThan(zIndex(drawing.id));

      app.layers.setOrder([
        'ol-tools:measure-angle',
        measuring.id,
        'ol-tools:draw-point',
        drawing.id,
        'business',
      ]);
      const orderAfterDrag = [zIndex(measuring.id), zIndex(drawing.id), zIndex('business')];
      await tools.importResults([
        {
          ...angle,
          id: 'distance',
          toolId: 'measure-distance',
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [100, 0],
            ],
          },
        },
        { ...angle, id: 'line', toolId: 'draw-line' },
      ]);
      expect(app.layers.get(drawing.id)).toBe(drawing);
      expect(app.layers.get(measuring.id)).toBe(measuring);
      expect(drawing.getMetadata().childIds).toEqual(['ol-tools:draw-point', 'ol-tools:draw-line']);
      expect(measuring.getMetadata().childIds).toEqual([
        'ol-tools:measure-angle',
        'ol-tools:measure-distance',
      ]);
      expect([zIndex(measuring.id), zIndex(drawing.id), zIndex('business')]).toEqual(
        orderAfterDrag
      );
      expect(tools.list()).toHaveLength(4);
    } finally {
      await app.dispose();
    }
  }
);

it('writes to configured GeoJSON targets and lazily groups the remaining tool types', async () => {
  const app = createGISApp().use(createOLAdapter({ controls: false, interactions: false }));
  await app.init({
    tools: { draw: { targets: { point: 'locations' } }, measure: { targets: { area: 'areas' } } },
    layers: [
      {
        id: 'locations',
        type: 'geojson',
        source: {
          type: 'inline',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                id: 'existing',
                properties: {},
                geometry: { type: 'Point', coordinates: [0, 0] },
              },
            ],
          },
        },
      },
      { id: 'areas', type: 'geojson', source: { type: 'inline', data: collection } },
    ],
  });
  const map = useOLMap(app);
  try {
    expect(app.layers.list().map(({ id }) => id)).toEqual(['locations', 'areas']);
    const tools = useOLTools(app);
    await app.interactions.activateTool('draw-point');
    const draw = map
      .getInteractions()
      .getArray()
      .find((item) => item instanceof Draw)!;
    draw.dispatchEvent({
      type: 'drawend',
      feature: new Feature(new Point([111319.490793, 0])),
    } as never);
    expect(app.data.get('layer:locations')?.data).toMatchObject({
      features: [
        { id: 'existing' },
        {
          id: tools.list()[0]!.id,
          geometry: { coordinates: [expect.closeTo(1), expect.closeTo(0)] },
        },
      ],
    });
    expect(app.layers.has('ol-tools:draw')).toBe(false);
    const points = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 0],
    ];
    await tools.importResults([
      {
        id: 'line',
        toolId: 'draw-line',
        projection: 'EPSG:3857',
        geometry: { type: 'LineString', coordinates: points.slice(0, 2) },
      },
      {
        id: 'polygon',
        toolId: 'draw-polygon',
        projection: 'EPSG:3857',
        geometry: { type: 'Polygon', coordinates: [points] },
      },
      {
        id: 'distance',
        toolId: 'measure-distance',
        projection: 'EPSG:3857',
        geometry: { type: 'LineString', coordinates: points.slice(0, 2) },
      },
      {
        id: 'area',
        toolId: 'measure-area',
        projection: 'EPSG:3857',
        geometry: { type: 'Polygon', coordinates: [points] },
      },
    ]);
    expect(app.layers.get('ol-tools:draw')?.getMetadata().childIds).toEqual([
      'ol-tools:draw-line',
      'ol-tools:draw-polygon',
    ]);
    expect(app.layers.get('ol-tools:measure')?.getMetadata().childIds).toEqual([
      'ol-tools:measure-distance',
    ]);
    expect(app.data.get('layer:areas')?.data).toMatchObject({
      features: [{ id: 'area', properties: { value: expect.any(Number), unit: 'm²' } }],
    });
    expect(app.layers.getDataLocation('areas')).toBeDefined();
    await app.layers.update('areas', { options: { opacity: 0.4 } });
    expect(app.layers.get('areas')?.getMetadata().opacity).toBe(0.4);
    await app.interactions.activateTool('measure-distance');
    await tools.cancel();
    expect(tools.list()).toHaveLength(5);
    await tools.clear();
    expect(tools.list()).toHaveLength(0);
    expect(map.getOverlays().getLength()).toBe(0);
    expect(app.data.get('layer:locations')?.data).toMatchObject({ features: [{ id: 'existing' }] });
    expect(app.layers.get('areas')?.getMetadata().opacity).toBe(0.4);
    expect(app.layers.getDataLocation('areas')).toBeUndefined();
    expect(app.config?.layers?.map(({ id }) => id)).toEqual(['locations', 'areas']);
  } finally {
    await app.dispose();
  }
});

it.each(['missing', 'tiles'])(
  'reports an explicit invalid tool target %s without creating defaults',
  async (id) => {
    const app = createGISApp().use(createOLAdapter({ controls: false, interactions: false }));
    try {
      await app.init({
        tools: { draw: { targets: { point: id } } },
        layers: [
          { id: 'tiles', type: 'xyz', source: { url: 'https://example.com/{z}/{x}/{y}.png' } },
        ],
      });
      await expect(app.interactions.activateTool('draw-point')).rejects.toThrow(
        `requires a writable inline GeoJSON layer "${id}"`
      );
      expect(app.layers.list().map((layer) => layer.id)).toEqual(['tiles']);
      expect(app.interactions.getActiveTool()).toBeUndefined();
    } finally {
      await app.dispose();
    }
  }
);

it('allows retry of a failed GeoJSON URL with the same id', async () => {
  const app = createGISApp();
  app.use(createOLAdapter({ controls: false, interactions: false }));
  await app.init({});
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, json: async () => collection })
  );
  const config = {
    id: 'retry',
    type: 'geojson',
    source: { type: 'url', url: '/data.json' },
  } as const;
  try {
    await expect(app.layers.add(config)).rejects.toThrow();
    expect(app.data.get('layer:retry')).toBeUndefined();
    await app.layers.add(config);
    expect(app.layers.has('retry')).toBe(true);
  } finally {
    await app.dispose();
  }
});
