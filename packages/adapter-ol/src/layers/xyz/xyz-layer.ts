import type { LayerConfig } from '@joinmap/gis-core';
import XYZ from 'ol/source/XYZ.js';
import type { LayerBinding } from '../common/layer-binding.js';
import { createTileLayerBinding, requireTileSource } from '../common/tile-layer.js';

export function createXYZLayer(config: LayerConfig): LayerBinding {
  const { url } = requireTileSource(config);
  return createTileLayerBinding(config, new XYZ({ url }));
}
