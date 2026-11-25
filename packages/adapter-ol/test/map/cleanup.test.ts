import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGISApp } from '@joinmap/gis-core';
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
