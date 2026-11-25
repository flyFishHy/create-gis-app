import type { JsonValue, LayerConfig, LayerUpdate, MapLayerHandle } from '@joinmap/gis-core';
import type BaseLayer from 'ol/layer/Base.js';
import VectorLayer from 'ol/layer/Vector.js';
import { createLayerStyling } from './style-controller.js';
import { findVectorFeature } from '../../interactions/feature-reference.js';
import { runCleanups } from '../../lifecycle/run-cleanups.js';

function commitLayerUpdate(
  layer: BaseLayer,
  patch: LayerUpdate,
  style:
    | {
        apply(): void;
        rollback(): void;
      }
    | undefined
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

export function createLayerHandle(
  layer: BaseLayer,
  config: LayerConfig,
  dispose: MapLayerHandle['dispose'] = () => undefined
) {
  const styling = createLayerStyling(layer, config);
  const validateOptions = (options: Readonly<Record<string, JsonValue>>) => {
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
  };
  if (config.options) {
    validateOptions(config.options);
    if (typeof config.options.opacity === 'number') {
      layer.setOpacity(config.options.opacity);
    }
  }
  styling.apply();
  layer.set('gisLayerId', config.id);
  const commitUpdate = (patch: LayerUpdate): undefined => {
    if (patch.options) {
      validateOptions(patch.options);
    }
    commitLayerUpdate(layer, patch, styling.prepareUpdate(patch));
  };
  const handle: MapLayerHandle = {
    ...styling.methods,
    setVisible: (visible) => layer.setVisible(visible),
    setZIndex: (zIndex) => layer.setZIndex(zIndex),
    commitUpdate,
    update: commitUpdate,
    dispose,
    getMetadata: () => ({
      olLayerType: layer.constructor.name,
      opacity: layer.getOpacity(),
      zIndex: layer.getZIndex() ?? 0,
    }),
  };
  if (layer instanceof VectorLayer) {
    handle.canSelectFeature = (reference) => {
      const feature = findVectorFeature(layer.getSource(), reference);
      return feature ? styling.matchesFeature(feature) : reference.featureKey === undefined;
    };
  }

  return {
    handle,
    matchesFeature: styling.matchesFeature,
    setTimePredicate: styling.setTimePredicate,
  };
}
