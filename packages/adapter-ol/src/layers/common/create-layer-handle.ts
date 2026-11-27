import type {
  EngineLayerPatch,
  JsonValue,
  LayerCapabilities,
  LayerConfig,
  MapLayerHandle,
} from '@joinmap/gis-core';
import type BaseLayer from 'ol/layer/Base.js';
import {
  defaultVectorStyle,
  resolveSingleSymbolLegend,
  validateLegendColors,
} from './layer-legend.js';
import { runCleanups } from '../../lifecycle/run-cleanups.js';

function commitLayerUpdate(
  layer: BaseLayer,
  patch: EngineLayerPatch,
  style: PreparedLayerUpdate | undefined
): void {
  const rollbacks: (() => void)[] = [];
  const apply = <Value>(
    next: Value | undefined,
    read: () => Value,
    write: (value: Value) => void
  ) => {
    if (next !== undefined) {
      const previous = read();
      rollbacks.push(() => write(previous));
      write(next);
    }
  };
  try {
    if (style) {
      rollbacks.push(style.rollback);
      style.apply();
    }
    const opacity = patch.options?.opacity;
    apply(
      typeof opacity === 'number' ? opacity : undefined,
      () => layer.getOpacity(),
      (value) => layer.setOpacity(value)
    );
    apply(
      patch.visible,
      () => layer.getVisible(),
      (value) => layer.setVisible(value)
    );
    apply(
      patch.zIndex,
      () => layer.getZIndex(),
      (value) => {
        if (value === undefined) {
          layer.unset('zIndex');
        } else {
          layer.setZIndex(value);
        }
      }
    );
    apply(
      patch.title,
      () => layer.get('title') as string | undefined,
      (value) => {
        if (value === undefined) {
          layer.unset('title');
        } else {
          layer.set('title', value);
        }
      }
    );
  } catch (cause) {
    const errors = runCleanups(rollbacks.reverse());
    if (errors.length) {
      throw new AggregateError(errors, 'Could not restore the previous OL layer state.', { cause });
    }
    throw cause;
  }
}

export function validateOLOptions(options: Readonly<Record<string, JsonValue>>): void {
  for (const key of Object.keys(options)) {
    if (key !== 'opacity') {
      throw new Error(`Unsupported OL layer option "${key}". Put style at layer.style.`);
    }
  }
  if (
    options.opacity !== undefined &&
    (typeof options.opacity !== 'number' ||
      !Number.isFinite(options.opacity) ||
      options.opacity < 0 ||
      options.opacity > 1)
  ) {
    throw new Error('opacity must be a number between 0 and 1.');
  }
}

export interface PreparedLayerUpdate {
  apply(): void;
  rollback(): void;
}

export interface OLLayerHandleOptions {
  readonly dispose?: MapLayerHandle['dispose'];
  readonly capabilities?: Readonly<Partial<LayerCapabilities>>;
  readonly prepareUpdate?: (patch: EngineLayerPatch) => PreparedLayerUpdate | undefined;
  readonly validateOptions?: (options: Readonly<Record<string, JsonValue>>) => void;
}

export function validateStaticLegend(patch: Pick<EngineLayerPatch, 'legend' | 'style'>): undefined {
  if (patch.style) {
    throw new Error('style requires a vector layer.');
  }
  if (patch.legend?.field) {
    throw new Error('Field-based legend rules require a vector layer.');
  }
  validateLegendColors(patch.legend);
  return undefined;
}

export function createLayerHandle(
  layer: BaseLayer,
  config: LayerConfig,
  options: OLLayerHandleOptions = {}
): MapLayerHandle {
  const prepareUpdate = options.prepareUpdate ?? validateStaticLegend;
  const validateOptions = options.validateOptions ?? validateOLOptions;
  if (!options.prepareUpdate) {
    validateStaticLegend(config);
  }
  if (config.options) {
    validateOptions(config.options);
    if (typeof config.options.opacity === 'number') {
      layer.setOpacity(config.options.opacity);
    }
  }
  layer.set('gisLayerId', config.id);
  const commitUpdate = (patch: EngineLayerPatch): undefined => {
    if (patch.options) {
      validateOptions(patch.options);
    }
    commitLayerUpdate(layer, patch, prepareUpdate(patch));
  };
  return {
    capabilities: {
      legend: { resolveLegend: (legend) => resolveSingleSymbolLegend(legend, defaultVectorStyle) },
      ...options.capabilities,
    },
    setVisible: (visible) => layer.setVisible(visible),
    setZIndex: (zIndex) => layer.setZIndex(zIndex),
    commitUpdate,
    update: commitUpdate,
    dispose: options.dispose ?? (() => undefined),
    getMetadata: () => ({
      olLayerType: layer.constructor.name,
      opacity: layer.getOpacity(),
      zIndex: layer.getZIndex() ?? 0,
    }),
  };
}
