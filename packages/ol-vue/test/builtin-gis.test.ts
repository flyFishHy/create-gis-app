import { afterEach, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import Draw from 'ol/interaction/Draw.js';
import Modify from 'ol/interaction/Modify.js';
import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import Point from 'ol/geom/Point.js';
import Polygon from 'ol/geom/Polygon.js';
import VectorLayer from 'ol/layer/Vector.js';
import CircleStyle from 'ol/style/Circle.js';
import type { StyleFunction } from 'ol/style/Style.js';
import { createGISApp } from '@joinmap/gis-core';
import { createOLAdapter, useOLMap, useOLTools } from '../../adapter-ol/src/index.js';
import { createVueUI } from '../../ui-vue/src/vue-ui.js';
import type { GISUIContext } from '../../ui-vue/src/types.js';

afterEach(() => vi.unstubAllGlobals());
it('provides tools, properties, pointer status and scale with only the two default plugins', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  const app = createGISApp();
  let ui!: GISUIContext;
  app.use(createOLAdapter({ controls: false, interactions: false }));
  app.use(
    createVueUI({
      extensions: [
        {
          name: 'test-capture',
          install(context) {
            ui = context;
          },
        },
      ],
    })
  );
  const target = document.createElement('div');
  document.body.append(target);
  try {
    await app.init({
      map: { projection: 'EPSG:3857', center: [0, 0], zoom: 3 },
      ui: { layout: 'overlay-dashboard' },
    });
    const map = useOLMap(app);
    const pointerListeners = () => map.getListeners('pointermove')?.length ?? 0;
    const originalListeners = pointerListeners();
    await app.mount(target);
    expect(app.interactions.hasTool('measure-distance')).toBe(true);
    expect(pointerListeners()).toBe(originalListeners + 1);
    expect(target.querySelector('.gis-ui-panel-host--properties')).toBeNull();
    expect(target.querySelector('.gis-ui-status-details')!.textContent).toMatch(/1:/);
    const revision = app.context.state.snapshot().revision;
    const coordinates = () => target.querySelector('.gis-ui-status-coordinates output')!;
    expect(coordinates().textContent).toBe('--');
    map.dispatchEvent({
      type: 'pointermove',
      coordinate: [1113194.9079, 2273030.927],
      dragging: false,
    } as never);
    await nextTick();
    expect(coordinates().textContent).toBe('10.00000,20.00000');
    expect(coordinates().children).toHaveLength(0);
    map.getViewport()!.dispatchEvent(new Event('pointerleave'));
    await nextTick();
    expect(coordinates().textContent).toBe('10.00000,20.00000');
    map.dispatchEvent({
      type: 'pointermove',
      coordinate: [-1113194.9079, -2273030.927],
      dragging: false,
    } as never);
    await nextTick();
    expect(coordinates().textContent).toBe('-10.00000,-20.00000');
    expect(app.context.state.snapshot().revision).toBe(revision);
    ui.panels.hide('status');
    await nextTick();
    expect(target.querySelector('.gis-ui-status-content')).toBeNull();
    expect(pointerListeners()).toBe(originalListeners);
    ui.panels.show('status');
    await nextTick();
    expect(pointerListeners()).toBe(originalListeners + 1);
    expect(coordinates().textContent).toBe('-10.00000,-20.00000');
    const measureButton = target.querySelector<HTMLButtonElement>('button[aria-label="测量距离"]')!;
    measureButton.focus();
    measureButton.click();
    await flushPromises();
    const getDraw = () =>
      map
        .getInteractions()
        .getArray()
        .find((item) => item instanceof Draw);
    const draw = getDraw()!;
    const undo = vi.spyOn(draw, 'removeLastPoint');
    const viewport = target.querySelector<HTMLElement>('.gis-ui-map-viewport')!;
    viewport.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
    );
    expect(undo).toHaveBeenCalledTimes(1);
    expect(target.querySelector('.gis-ui-layer-manager')?.textContent).not.toContain('测量结果');
    expect(app.interactions.getActiveTool()).toBe('measure-distance');
    measureButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    expect(app.interactions.getActiveTool()).toBeUndefined();
    expect(getDraw()).toBeUndefined();
    expect(useOLTools(app).list()).toHaveLength(0);

    measureButton.click();
    await flushPromises();
    getDraw()!.dispatchEvent({
      type: 'drawend',
      feature: new Feature(
        new LineString([
          [0, 0],
          [1000, 0],
        ])
      ),
    } as never);
    await vi.waitFor(() => expect(useOLTools(app).list()).toHaveLength(1));
    await vi.waitFor(() => expect(app.interactions.getActiveTool()).toBeUndefined());
    const result = useOLTools(app).list()[0]!;
    useOLTools(app).select(result.id);
    await nextTick();
    expect(target.querySelector('.gis-ui-panel-host--properties')?.textContent).toContain(
      'measure-distance'
    );
    const group = [...target.querySelectorAll('.gis-ui-layer-row.is-root')].find(
      (row) => row.querySelector('.gis-ui-layer-name')?.textContent?.trim() === '测量结果'
    );
    expect(group?.querySelector('.gis-ui-layer-expand')?.getAttribute('aria-expanded')).toBe(
      'false'
    );
    expect(group?.querySelector('.gis-ui-layer-settings')).toBeNull();
    target.querySelector<HTMLButtonElement>('button[aria-label="删除测量结果"]')!.click();
    await flushPromises();
    expect(useOLTools(app).list()).toHaveLength(0);
    expect(app.interactions.getSelection()).toBeUndefined();
    expect(app.interactions.getActiveTool()).toBeUndefined();
    await useOLTools(app).importResults([
      {
        id: 'clear-me',
        toolId: 'draw-point',
        projection: 'EPSG:3857',
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
    ]);
    target.querySelector<HTMLButtonElement>('button[aria-label="绘制点"]')!.click();
    await flushPromises();
    expect(app.interactions.getActiveTool()).toBe('draw-point');
    target.querySelector<HTMLButtonElement>('button[aria-label="清空全部结果"]')!.click();
    await flushPromises();
    expect(useOLTools(app).list()).toHaveLength(0);
    expect(app.interactions.getActiveTool()).toBeUndefined();
    await app.unmount();
    expect(pointerListeners()).toBe(originalListeners);
  } finally {
    await app.dispose();
    target.remove();
  }
});

it('respects tools:false and explicit properties/status configuration without UI integration plugins', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  const app = createGISApp();
  app.use(createOLAdapter({ tools: false, controls: false, interactions: false }));
  app.use(createVueUI());
  const target = document.createElement('div');
  document.body.append(target);
  try {
    await app.init({
      map: { center: [0, 0], zoom: 2 },
      ui: {
        tools: ['zoom-in', 'draw-point'],
        panels: [
          { id: 'properties', visible: false },
          { id: 'status', visible: false },
        ],
      },
    });
    await app.mount(target);
    expect(app.interactions.hasTool('draw-point')).toBe(false);
    expect(() => useOLTools(app)).toThrow();
    expect(target.querySelector('button[aria-label="放大"]')).not.toBeNull();
    expect(target.querySelector('button[aria-label="缩小"]')).toBeNull();
    expect(target.querySelector('button[aria-label="绘制点"]')).toBeNull();
    expect(target.querySelector('.gis-ui-status-content')).toBeNull();
    app.interactions.select({ feature: { layerId: 'external', id: 'one' } });
    await nextTick();
    expect(target.querySelector('.gis-ui-panel-host--properties')).toBeNull();
  } finally {
    await app.dispose();
    target.remove();
  }
});

it('themes drawing and measurement sketches, results, and edit handles', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  let ui!: GISUIContext;
  const app = createGISApp()
    .use(createOLAdapter({ controls: false, interactions: false }))
    .use(
      createVueUI({
        extensions: [
          {
            name: 'capture-theme',
            install(context) {
              ui = context;
            },
          },
        ],
      })
    );
  const target = document.createElement('div');
  document.body.append(target);
  try {
    await app.init({
      map: { projection: 'EPSG:4326', center: [0, 0], zoom: 2 },
      ui: { theme: { tokens: { colorPrimary: '#08875a' } } },
    });
    await app.mount(target);
    const map = useOLMap(app);
    const line = new LineString([
      [0, -1],
      [0, 0],
      [-1, 0],
    ]);
    const polygon = new Polygon([
      [
        [0, -1],
        [0, 0],
        [-1, 0],
        [0, -1],
      ],
    ]);
    const point = new Point([0, 0]);
    const cases = [
      ['draw-point', point],
      ['draw-line', line],
      ['draw-polygon', polygon],
      ['measure-distance', line],
      ['measure-area', polygon],
      ['measure-angle', line],
    ] as const;
    const expectColors = (
      style: StyleFunction,
      feature: Feature,
      color: number[],
      angle = false
    ) => {
      const styles = style(feature, map.getView().getResolution()!);
      expect(Array.isArray(styles)).toBe(true);
      const [shape, vertex, arc] = Array.isArray(styles) ? styles : [];
      const geometry = feature.getGeometry();
      const marker = (geometry instanceof Point ? shape : vertex)?.getImage() as CircleStyle;
      expect(marker.getFill()?.getColor()).toEqual(color);
      expect(marker.getStroke()?.getColor()).toEqual(color);
      if (!(geometry instanceof Point)) {
        expect(shape?.getStroke()?.getColor()).toEqual(color);
      }
      if (geometry instanceof Polygon) {
        expect(shape?.getFill()?.getColor()).toEqual([...color.slice(0, 3), 0.16]);
      }
      if (angle) {
        expect(arc?.getStroke()?.getColor()).toEqual(color);
      }
    };
    const results: Feature[] = [];
    for (const [toolId, geometry] of cases) {
      await app.interactions.activateTool(toolId);
      const draw = map
        .getInteractions()
        .getArray()
        .find((item) => item instanceof Draw)!;
      const feature = new Feature(geometry.clone());
      expectColors(
        draw.getOverlay().getStyleFunction()!,
        feature,
        [8, 135, 90, 1],
        toolId === 'measure-angle'
      );
      draw.dispatchEvent({ type: 'drawend', feature } as never);
      await vi.waitFor(() => {
        expect(app.interactions.getActiveTool()).toBeUndefined();
        expect(app.layers.has(`ol-tools:${toolId}`)).toBe(true);
      });
      const layer = map
        .getLayers()
        .getArray()
        .find((item) => item.get('gisLayerId') === `ol-tools:${toolId}`) as VectorLayer;
      const result = layer.getSource()!.getFeatures()[0]!;
      expectColors(result.getStyleFunction()!, result, [8, 135, 90, 1], toolId === 'measure-angle');
      results.push(result);
    }
    useOLTools(app).select(String(results[0]!.getId()));
    await app.interactions.activateTool('modify-result');
    const modify = map
      .getInteractions()
      .getArray()
      .find((item) => item instanceof Modify)!;
    const expectUpdatedColors = () => {
      for (const result of results) {
        expectColors(
          result.getStyleFunction()!,
          result,
          [105, 68, 175, 1],
          result.get('gisToolId') === 'measure-angle'
        );
      }
      expectColors(modify.getOverlay().getStyleFunction()!, new Feature(point), [105, 68, 175, 1]);
    };
    ui.theme.set({ tokens: { colorPrimary: '#6944af' } });
    await vi.waitFor(expectUpdatedColors);
  } finally {
    await app.dispose();
    target.remove();
    vi.unstubAllGlobals();
  }
});
