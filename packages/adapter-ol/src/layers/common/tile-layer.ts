import type { JsonValue, LayerConfig } from '@joinmap/gis-core';
import TileLayer from 'ol/layer/Tile.js';
import type TileSource from 'ol/source/Tile.js';
import type { LayerBinding } from './layer-binding.js';
import { createLayerHandle } from './create-layer-handle.js';

export function requireTileSource(
  config: LayerConfig
): Readonly<Record<string, JsonValue | undefined>> & { readonly url: string } {
  const source = config.source;
  if (
    !source ||
    typeof source !== 'object' ||
    Array.isArray(source) ||
    typeof source.url !== 'string' ||
    !source.url.trim()
  ) {
    throw new Error(`Layer "${config.id}" requires source.url.`);
  }
  return { ...source, url: source.url };
}

export function createTileLayerBinding(config: LayerConfig, source: TileSource): LayerBinding {
  const layer = new TileLayer({ source });
  const dispose = () => {
    try {
      layer.dispose();
    } finally {
      source.dispose();
    }
  };
  try {
    const { handle } = createLayerHandle(layer, config, dispose);
    return { id: config.id, layer, handle };
  } catch (error) {
    dispose();
    throw error;
  }
}
