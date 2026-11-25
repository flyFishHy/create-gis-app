import type { MapConfig } from '@joinmap/gis-core';
import OlMap from 'ol/Map.js';
import View from 'ol/View.js';
import { defaults as defaultControls } from 'ol/control/defaults.js';
import { defaults as defaultInteractions } from 'ol/interaction/defaults.js';
import { runCleanups } from '../lifecycle/run-cleanups.js';

export interface OLMapOptions {
  readonly controls?: boolean;
  readonly zoomControl?: boolean;
  readonly interactions?: boolean;
  readonly projection?: string;
}

export class OLMapRuntime {
  private map?: OlMap;

  constructor(private readonly options: OLMapOptions) {}

  create(config: MapConfig): OlMap {
    if (this.map) {
      throw new Error('OpenLayers map has already been created.');
    }
    const view = new View({
      projection: config.projection ?? this.options.projection ?? 'EPSG:3857',
      center: config.center ? [...config.center] : undefined,
      zoom: config.zoom,
      minZoom: config.minZoom,
      maxZoom: config.maxZoom,
    });
    const map = new OlMap({
      view,
      controls:
        this.options.controls === false
          ? []
          : defaultControls({ zoom: this.options.zoomControl ?? true }),
      interactions:
        this.options.interactions === false ? [] : defaultInteractions({ onFocusOnly: false }),
    });
    this.map = map;
    return map;
  }

  getMap(): OlMap {
    if (!this.map) {
      throw new Error('OpenLayers map has not been initialized.');
    }
    return this.map;
  }

  getSize(): [number, number] | undefined {
    const size = this.getMap().getSize();
    return size ? [size[0], size[1]] : undefined;
  }

  updateSize(): void {
    this.getMap().updateSize();
  }

  setTarget(target: HTMLElement | string | undefined): void {
    this.getMap().setTarget(target);
  }

  destroy(): void {
    const map = this.map;
    if (!map) {
      return;
    }
    this.map = undefined;
    const errors = runCleanups([
      () => map.setTarget(undefined),
      () => map.setLayers([]),
      () => map.dispose(),
    ]);
    if (errors.length) {
      throw new AggregateError(errors, 'Could not fully release OpenLayers map.');
    }
  }
}
