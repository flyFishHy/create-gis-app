import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGISApp } from '@joinmap/gis-core';
import VectorLayer from 'ol/layer/Vector.js';
import { createOLAdapter, useOLMap } from '../../src/index.js';

const center = [0, 0] as const;

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

it('reports a failed vector synchronization and rebuilds from the next dataset update', async () => {
  const app = createGISApp().use(createOLAdapter({ tools: false }));
  try {
    await app.init({
      layers: [
        {
          id: 'points',
          type: 'geojson',
          source: { type: 'inline', data: { type: 'FeatureCollection', features: [] } },
        },
      ],
    });
    const layer = useOLMap(app).getLayers().item(0) as VectorLayer;
    const source = layer.getSource()!;
    const data = app.data.get('layer:points')!;
    const next = {
      type: 'Feature',
      id: 'new-point',
      geometry: { type: 'Point', coordinates: [1, 2] },
      properties: {},
    };
    const error = vi.fn();
    app.events.on('app:error', error);
    const failure = new Error('injected addFeatures failure');
    vi.spyOn(source, 'addFeatures').mockImplementationOnce(() => {
      throw failure;
    });
    data.update(next);
    expect(data.data).toBe(next);
    expect(source.getFeatureById('new-point')).toBeNull();
    expect(error).toHaveBeenCalledExactlyOnceWith({
      error: expect.objectContaining({ stage: 'data-observer', cause: failure }),
    });
    data.update(next);
    expect(source.getFeatureById('new-point')).not.toBeNull();
  } finally {
    await app.dispose();
  }
});

it('detaches a partially added GeoJSON layer and releases its owned dataset', async () => {
  const app = createGISApp().use(createOLAdapter({ tools: false }));
  try {
    await app.init({ map: { center, zoom: 3 } });
    const layers = useOLMap(app).getLayers();
    const initial = layers.getLength();
    const failure = new Error('injected failure after layer insertion');
    const push = layers.push.bind(layers);
    vi.spyOn(layers, 'push').mockImplementationOnce((layer) => {
      push(layer);
      throw failure;
    });
    const config = {
      id: 'points',
      type: 'geojson',
      source: { type: 'inline', data: { type: 'FeatureCollection', features: [] } },
    };
    await expect(app.layers.add(config)).rejects.toBe(failure);
    expect(layers.getLength()).toBe(initial);
    expect(app.layers.has('points')).toBe(false);
    expect(app.data.get('layer:points')).toBeUndefined();
    await app.layers.add(config);
    expect(layers.getLength()).toBe(initial + 1);
  } finally {
    await app.dispose();
  }
});

it('releases all popups, listeners and the map target even if one popup cleanup throws', async () => {
  const app = createGISApp().use(createOLAdapter({ tools: false }));
  const target = document.body.appendChild(document.createElement('div'));
  const first = document.createElement('div');
  const second = document.createElement('div');
  const disconnect = vi.fn();
  try {
    await app.init({ map: { center, zoom: 3 } });
    const map = useOLMap(app);
    map.setTarget(target);
    const viewport = map.getViewport()!;
    expect(target.contains(viewport)).toBe(true);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private element?: Element;
        observe(element: Element) {
          this.element = element;
        }
        disconnect() {
          disconnect(this.element);
          if (this.element === second) throw new Error('injected popup cleanup failure');
        }
      }
    );
    app.map.addPopupOverlay(first, { coordinate: center });
    app.map.addPopupOverlay(second, { coordinate: center });
    expect(map.getOverlays().getLength()).toBe(2);

    await expect(app.dispose()).rejects.toMatchObject({ code: 'APP_DISPOSE_FAILED' });
    expect(disconnect.mock.calls).toEqual([[second], [first]]);
    expect(map.getOverlays().getLength()).toBe(0);
    expect(map.getListeners('postrender') ?? []).toHaveLength(0);
    expect(map.getTargetElement()).toBeFalsy();
    expect(target.contains(viewport)).toBe(false);
  } finally {
    await app.dispose().catch(() => undefined);
    target.remove();
  }
});

it('rolls back an overlay if observing its element fails during setup', async () => {
  const app = createGISApp().use(createOLAdapter({ tools: false }));
  try {
    await app.init({ map: { center, zoom: 3 } });
    const map = useOLMap(app);
    const count = map.getListeners('postrender')?.length ?? 0;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {
          throw new Error('injected observer setup failure');
        }
        disconnect() {
          disconnect();
        }
      }
    );
    expect(() =>
      app.map.addPopupOverlay(document.createElement('div'), { coordinate: center })
    ).toThrow('injected observer setup failure');
    expect(disconnect).toHaveBeenCalledOnce();
    expect(map.getOverlays().getLength()).toBe(0);
    expect(map.getListeners('postrender') ?? []).toHaveLength(count);
  } finally {
    await app.dispose();
  }
});
