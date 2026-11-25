import type { LayerConfig } from '@joinmap/gis-core';
import TileWMS from 'ol/source/TileWMS.js';
import type { LayerBinding } from '../common/layer-binding.js';
import { createTileLayerBinding, requireTileSource } from '../common/tile-layer.js';

export function createWMSLayer(config: LayerConfig): LayerBinding {
  const { url, params } = requireTileSource(config);
  if (
    !params ||
    typeof params !== 'object' ||
    Array.isArray(params) ||
    typeof params.LAYERS !== 'string' ||
    !params.LAYERS.trim()
  ) {
    throw new Error(`Layer "${config.id}" requires source.params.LAYERS.`);
  }
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error(`Layer "${config.id}" requires a scalar value for source.params.${key}.`);
    }
  }
  return createTileLayerBinding(config, new TileWMS({ url, params: { ...params } }));
}
