import type { LayerCapabilities, MapLayerHandle } from '../types.js';

/** Resolve legacy flat methods at the same boundary without changing handle identity. */
export function layerCapability<Key extends keyof LayerCapabilities>(
  handle: MapLayerHandle | undefined,
  key: Key
): LayerCapabilities[Key] | MapLayerHandle | undefined {
  return handle?.capabilities?.[key] ?? handle;
}
