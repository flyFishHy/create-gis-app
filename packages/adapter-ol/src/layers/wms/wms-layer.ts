import type { WMSLayerConfig } from '../ol-layer-config.js';
import TileWMS from 'ol/source/TileWMS.js';
import type { LayerBinding } from '../common/layer-binding.js';
import { createTileLayerBinding } from '../common/tile-layer.js';

export function createWMSLayer(config: WMSLayerConfig): LayerBinding {
  const { url, params } = config.source;
  return createTileLayerBinding(config, new TileWMS({ url, params: { ...params } }));
}
