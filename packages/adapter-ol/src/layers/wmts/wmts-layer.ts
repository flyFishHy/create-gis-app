import { GISRuntimeError, ResourceScopeImpl } from '@joinmap/gis-core';
import type { DataService, LayerConfig } from '@joinmap/gis-core';
import WMTSCapabilities from 'ol/format/WMTSCapabilities.js';
import WMTS, { optionsFromCapabilities } from 'ol/source/WMTS.js';
import type { LayerBinding } from '../common/layer-binding.js';
import { loadOwnedDataSet } from '../common/layer-data.js';
import { createTileLayerBinding, requireTileSource } from '../common/tile-layer.js';

export async function createWMTSLayer(
  data: DataService,
  config: LayerConfig
): Promise<LayerBinding> {
  const { url, layer, matrixSet } = requireTileSource(config);
  if (typeof layer !== 'string' || !layer.trim()) {
    throw new Error(`Layer "${config.id}" requires source.layer.`);
  }
  if (typeof matrixSet !== 'string' || !matrixSet.trim()) {
    throw new Error(`Layer "${config.id}" requires source.matrixSet.`);
  }

  const resources = new ResourceScopeImpl();
  let xml: string | undefined;
  try {
    const capabilities = await loadOwnedDataSet<string>(data, resources, {
      id: `wmts-capabilities:${config.id}`,
      type: 'url',
      format: 'text',
      url,
    });
    xml = capabilities.data;
  } finally {
    await resources.dispose();
  }

  let options;
  try {
    const capabilities = xml && new WMTSCapabilities().read(xml);
    if (!capabilities) {
      throw new Error('Expected a WMTS GetCapabilities document.');
    }
    options = optionsFromCapabilities(capabilities, { layer, matrixSet });
    // OpenLayers falls back to the first advertised matrix set if the ID does not match.
    if (!options || options.matrixSet !== matrixSet || !options.urls?.length) {
      throw new Error(`No usable tile source for layer "${layer}" and matrix set "${matrixSet}".`);
    }
  } catch (cause) {
    throw new GISRuntimeError({
      code: 'DATA_LOAD_FAILED',
      stage: 'layer-create',
      message: `Could not create WMTS layer "${config.id}" from its capabilities.`,
      detail: { layerId: config.id, layer, matrixSet },
      cause,
    });
  }
  return createTileLayerBinding(config, new WMTS(options));
}
