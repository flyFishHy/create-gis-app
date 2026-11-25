import type { JsonValue, LayerConfig, MapLayerHandle } from '@joinmap/gis-core';
import type BaseLayer from 'ol/layer/Base.js';
import VectorLayer from 'ol/layer/Vector.js';
import { createLayerStyling } from './style-controller.js';
import { findVectorFeature } from '../../interactions/feature-reference.js';

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
  const handle: MapLayerHandle = {
    ...styling.methods,
    setVisible: (visible) => layer.setVisible(visible),
    setZIndex: (zIndex) => layer.setZIndex(zIndex),
    update: (patch) => {
      const applyStyle = styling.prepareUpdate(patch);
      if (patch.options) {
        validateOptions(patch.options);
      }
      // Prepare every value before committing any engine mutations.
      applyStyle();
      if (typeof patch.options?.opacity === 'number') {
        layer.setOpacity(patch.options.opacity);
      }
      if (patch.visible !== undefined) {
        layer.setVisible(patch.visible);
      }
      if (patch.zIndex !== undefined) {
        layer.setZIndex(patch.zIndex);
      }
      if (patch.title !== undefined) {
        layer.set('title', patch.title);
      }
    },
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
