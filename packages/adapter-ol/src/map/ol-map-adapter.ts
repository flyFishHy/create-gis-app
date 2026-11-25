import type {
  GISApp,
  MapAdapter,
  MapConfig,
  MapLayerHandle,
  MapLocation,
  MapOverlayAnchor,
  MapStateSnapshot,
  MapViewService,
  Unsubscribe,
} from '@joinmap/gis-core';
import { toLonLat } from 'ol/proj.js';
import type OlMap from 'ol/Map.js';
import { unByKey } from 'ol/Observable.js';
import { installFeaturePicking } from '../interactions/feature-hit-bridge.js';
import { OLSelectionHighlight } from '../interactions/selection-highlight.js';
import { createPopupOverlay } from '../overlays/popup-overlay.js';
import { runCleanups } from '../lifecycle/run-cleanups.js';
import { OLLayerCollection } from './layer-collection.js';
import { OLMapRuntime, type OLMapOptions } from './map-runtime.js';
import { getOLView, getOLViewState, locateOLView, onOLViewChange } from './map-view.js';

export class OLMapAdapter implements MapAdapter {
  readonly name = 'openlayers';
  private stopPicking?: () => void;
  private readonly runtime: OLMapRuntime;
  private selectionHighlight?: OLSelectionHighlight;
  readonly layerCollection = new OLLayerCollection(() => this.getMap());
  private readonly popupCleanups = new Set<Unsubscribe>();

  constructor(
    options: OLMapOptions,
    private readonly app: Pick<GISApp, 'layers' | 'interactions'>
  ) {
    this.runtime = new OLMapRuntime(options);
  }

  create(config: MapConfig): void {
    const map = this.runtime.create(config);
    const highlight = new OLSelectionHighlight(map, this.app);
    this.selectionHighlight = highlight;
    this.stopPicking = installFeaturePicking(map, this.app, highlight.layer);
  }

  destroy(): void {
    const stopPicking = this.stopPicking;
    this.stopPicking = undefined;
    const highlight = this.selectionHighlight;
    this.selectionHighlight = undefined;
    const errors = runCleanups([
      ...[...this.popupCleanups].reverse(),
      () => stopPicking?.(),
      () => highlight?.dispose(),
      () => this.runtime.destroy(),
      () => this.layerCollection.clearAttached(),
    ]);
    if (errors.length) {
      throw new AggregateError(errors, 'Could not fully destroy OpenLayers map.');
    }
  }

  locate(location: MapLocation): void {
    locateOLView(this.getMap().getView(), location);
  }

  getView(): MapViewService {
    return getOLView(this.getMap().getView());
  }

  getViewState(): Omit<MapStateSnapshot, 'ready'> {
    return getOLViewState(this.getMap().getView());
  }

  onViewChange(listener: () => void): Unsubscribe {
    return onOLViewChange(this.getMap(), listener);
  }

  getSize(): [number, number] | undefined {
    return this.runtime.getSize();
  }

  addPopupOverlay(element: HTMLElement, anchor: MapOverlayAnchor): Unsubscribe {
    const dispose = createPopupOverlay(this.getMap(), element, anchor);
    const cleanup = () => {
      if (this.popupCleanups.delete(cleanup)) {
        dispose();
      }
    };
    this.popupCleanups.add(cleanup);
    return cleanup;
  }

  onPointerMove(
    listener: (coordinate: readonly [number, number] | undefined) => void
  ): Unsubscribe {
    const map = this.getMap();
    const key = map.on('pointermove', (event) => {
      if (event.dragging) {
        return;
      }
      const position = toLonLat(event.coordinate, map.getView().getProjection());
      listener([position[0]!, position[1]!]);
    });
    const leave = () => listener(undefined);
    const viewport = map.getViewport();
    viewport?.addEventListener('pointerleave', leave);
    return () => {
      unByKey(key);
      viewport?.removeEventListener('pointerleave', leave);
    };
  }

  updateSize(): void {
    this.runtime.updateSize();
  }

  setTarget(target: HTMLElement | string | undefined): void {
    this.app.interactions.cancelFeaturePick();
    this.runtime.setTarget(target);
  }

  addLayer(handle: MapLayerHandle, index?: number): void {
    this.layerCollection.addLayer(handle, index);
  }

  removeLayer(handle: MapLayerHandle): void {
    this.layerCollection.removeLayer(handle);
  }

  setLayerOrder(handles: readonly MapLayerHandle[]): void {
    this.layerCollection.setLayerOrder(handles);
  }

  getMap(): OlMap {
    return this.runtime.getMap();
  }
}
