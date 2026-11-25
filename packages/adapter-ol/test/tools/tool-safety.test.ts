import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGISApp } from '@joinmap/gis-core';
import type { JsonValue } from '@joinmap/gis-core';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import Draw from 'ol/interaction/Draw.js';
import Modify from 'ol/interaction/Modify.js';
import VectorLayer from 'ol/layer/Vector.js';
import View from 'ol/View.js';
import { createOLAdapter, useOLMap, useOLTools } from '../../src/index.js';
import type { OLToolResult } from '../../src/index.js';

const point: OLToolResult = {
  id: 'point',
  toolId: 'draw-point',
  projection: 'EPSG:3857',
  geometry: { type: 'Point', coordinates: [1113194.9079, 0] },
};
const mapConfig = { center: [0, 0], zoom: 3 } as const;

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

it('keeps the source CRS on results and rejects geometry writes after a View projection change', async () => {
  const app = createGISApp().use(createOLAdapter());
  try {
    await app.init({ map: mapConfig });
    const tools = useOLTools(app);
    await tools.importResults([point]);
    const data = app.data.get('layer:ol-tools:draw-point')!;
    const previous = data.data;
    const map = useOLMap(app);
    map.setView(new View({ projection: 'EPSG:4326', center: [0, 0], zoom: 3 }));
    app.layers.setVisibility('ol-tools:draw-point', false);
    expect(tools.get(point.id)).toMatchObject({ projection: 'EPSG:3857' });
    expect(() => tools.updateGeometry(point.id, point.geometry)).toThrow('projection must match');
    await expect(
      tools.importResults([
        {
          ...point,
          id: 'new',
          projection: 'EPSG:4326',
          geometry: { type: 'Point', coordinates: [10, 0] },
        },
      ])
    ).rejects.toThrow('projection must match');
    expect(data.data).toBe(previous);

    map.setView(new View({ projection: 'EPSG:3857', center: [0, 0], zoom: 3 }));
    tools.updateGeometry(point.id, { type: 'Point', coordinates: [0, 0] });
    expect(tools.get(point.id)?.geometry.coordinates).toEqual([0, expect.closeTo(0, 6)]);
  } finally {
    await app.dispose();
  }
});

it('discards an active sketch on a projection change even if the original View returns', async () => {
  const app = createGISApp().use(createOLAdapter());
  try {
    await app.init({ map: mapConfig });
    const map = useOLMap(app);
    await app.interactions.activateTool('draw-point');
    const draw = map
      .getInteractions()
      .getArray()
      .find((item) => item instanceof Draw)!;
    map.setView(new View({ projection: 'EPSG:4326', center: [0, 0], zoom: 3 }));
    map.setView(new View({ projection: 'EPSG:3857', center: [0, 0], zoom: 3 }));
    draw.dispatchEvent({
      type: 'drawend',
      feature: new Feature(new Point([1113194.9079, 0])),
    } as never);
    expect(map.getInteractions().getArray()).not.toContain(draw);
    await vi.waitFor(() => expect(app.interactions.getActiveTool()).toBeUndefined());
    expect(app.layers.has('ol-tools:draw')).toBe(false);
    expect(useOLTools(app).list()).toEqual([]);
  } finally {
    await app.dispose();
  }
});

it.each([false, true])(
  'restores a Modify preview on cancellation or rejected commit (%s)',
  async (rejectCommit) => {
    const app = createGISApp().use(createOLAdapter());
    try {
      await app.init({ map: mapConfig });
      const tools = useOLTools(app);
      await tools.importResults([point]);
      tools.select(point.id);
      await app.interactions.activateTool('modify-result');
      const map = useOLMap(app);
      const layer = map.getLayers().item(0) as VectorLayer;
      const feature = layer.getSource()!.getFeatureById(point.id) as Feature<Point>;
      const before = feature.getGeometry()!.getCoordinates();
      const modify = map
        .getInteractions()
        .getArray()
        .find((item) => item instanceof Modify)!;
      const data = app.data.get('layer:ol-tools:draw-point')!;
      const saved = data.data;
      modify.dispatchEvent('modifystart');
      feature.getGeometry()!.setCoordinates([2000000, 100]);
      expect(feature.getGeometry()!.getCoordinates()).not.toEqual(before);

      if (rejectCommit) {
        data.validate(() => {
          throw new Error('edit rejected');
        });
        modify.dispatchEvent('modifyend');
        expect(feature.getGeometry()!.getCoordinates()).toEqual(before);
        expect(data.data).toBe(saved);
      }
      await tools.cancel();
      expect(feature.getGeometry()!.getCoordinates()).toEqual(before);
      expect(data.data).toBe(saved);
      expect(map.getInteractions().getArray()).not.toContain(modify);
      expect(app.interactions.getActiveTool()).toBeUndefined();
    } finally {
      await app.dispose();
    }
  }
);

it.each([false, true])(
  'rolls back earlier targets after a failed import, including when a rollback fails (%s)',
  async (rejectRollback) => {
    const app = createGISApp().use(createOLAdapter());
    const writeError = new Error('third target rejected the import');
    const rollbackError = new Error('second target rejected rollback');
    const empty = { type: 'FeatureCollection', features: [] };
    try {
      await app.init({
        map: mapConfig,
        layers: ['points', 'lines', 'areas'].map((id) => ({
          id,
          type: 'geojson',
          source: { type: 'inline', data: empty },
        })),
        tools: { draw: { targets: { point: 'points', line: 'lines', polygon: 'areas' } } },
      });
      const [points, lines, areas] = ['points', 'lines', 'areas'].map((id) =>
        app.data.get<JsonValue>(`layer:${id}`)!
      );
      if (rejectRollback) {
        lines!.validate((data) => {
          if ((data as typeof empty).features.length === 0) throw rollbackError;
        });
      }
      areas!.validate(() => {
        throw writeError;
      });
      const tools = useOLTools(app);
      const importing = tools.importResults([
        point,
        {
          ...point,
          id: 'line',
          toolId: 'draw-line',
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [100, 100],
            ],
          },
        },
        {
          ...point,
          id: 'area',
          toolId: 'draw-polygon',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [100, 0],
                [100, 100],
                [0, 0],
              ],
            ],
          },
        },
      ]);
      if (rejectRollback)
        await expect(importing).rejects.toMatchObject({
          cause: writeError,
          errors: [writeError, rollbackError],
        });
      else await expect(importing).rejects.toBe(writeError);
      expect(points!.data).toEqual(empty);
      expect(areas!.data).toEqual(empty);
      expect(tools.list().map(({ id }) => id)).toEqual(rejectRollback ? ['line'] : []);
    } finally {
      await app.dispose();
    }
  }
);

it('finishes the first accepted draw while a newly selected tool stays active', async () => {
  const app = createGISApp().use(createOLAdapter());
  let markStarted!: () => void;
  let allowAdd!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    allowAdd = resolve;
  });
  try {
    await app.init({ map: mapConfig });
    const add = app.layers.add.bind(app.layers);
    vi.spyOn(app.layers, 'add').mockImplementation(async (config) => {
      markStarted();
      await gate;
      return add(config);
    });
    const tools = useOLTools(app);
    const map = useOLMap(app);
    await app.interactions.activateTool('draw-point');
    const draw = map
      .getInteractions()
      .getArray()
      .find((item) => item instanceof Draw)!;
    draw.dispatchEvent({ type: 'drawend', feature: new Feature(new Point([0, 0])) } as never);
    await started;
    await tools.cancel();
    await app.interactions.activateTool('draw-line');
    allowAdd();
    await vi.waitFor(() =>
      expect(tools.list().map(({ toolId }) => toolId)).toEqual(['draw-point'])
    );
    expect(app.interactions.getActiveTool()).toBe('draw-line');
  } finally {
    allowAdd();
    await app.dispose();
  }
});
