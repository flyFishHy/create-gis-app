import type { XYZLayerConfig } from '../ol-layer-config.js';
import XYZ from 'ol/source/XYZ.js';
import type { LayerBinding } from '../common/layer-binding.js';
import { createTileLayerBinding } from '../common/tile-layer.js';

export function createXYZLayer(config: XYZLayerConfig): LayerBinding {
  const { url } = config.source;
  return createTileLayerBinding(config, new XYZ({ url }));
}
