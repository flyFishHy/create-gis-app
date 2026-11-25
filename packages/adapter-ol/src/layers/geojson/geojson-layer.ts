import { ResourceScopeImpl } from '@joinmap/gis-core';
import type { AppContext, JsonValue, LayerConfig, MapLayerHandle } from '@joinmap/gis-core';
import GeoJSON from 'ol/format/GeoJSON.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import type Projection from 'ol/proj/Projection.js';
import { createVectorProperties } from './vector-properties.js';
import { bindVectorData } from './vector-data-sync.js';
import { registerVectorSearch } from './vector-search.js';
import type { LayerBinding } from '../common/layer-binding.js';
import { loadOwnedDataSet } from '../common/layer-data.js';
import { createLayerHandle } from '../common/create-layer-handle.js';

export async function createGeoJSONLayer(
  context: AppContext,
  config: LayerConfig,
  getProjection: () => Projection
): Promise<LayerBinding> {
  const source = asObject(config.source);
  if (!source || (source.type !== 'url' && source.type !== 'inline')) {
    throw new Error(`Layer "${config.id}" requires a URL or inline data source.`);
  }
  const datasetId = `layer:${config.id}`;
  const resources = new ResourceScopeImpl();
  try {
    const dataSet = await loadOwnedDataSet<JsonValue>(context.data, resources, {
      id: datasetId,
      type: source.type,
      url: typeof source.url === 'string' ? source.url : undefined,
      data: source.data as JsonValue | undefined,
    });
    const projection = getProjection();
    const format = new GeoJSON({ featureProjection: projection });
    const features = format.readFeatures(dataSet.data as Record<string, unknown>);
    const vectorSource = new VectorSource({ features });
    resources.add(() => vectorSource.clear(true));
    const vectorLayer = new VectorLayer({ source: vectorSource });
    const {
      handle: base,
      matchesFeature,
      setTimePredicate,
    } = createLayerHandle(vectorLayer, config, () => resources.dispose());
    const properties = createVectorProperties(
      vectorSource,
      config.id,
      projection,
      getProjection,
      setTimePredicate,
      resources
    );
    bindVectorData(context, config.id, dataSet, vectorSource, format, properties, resources);
    resources.add(registerVectorSearch(context, config, vectorSource, projection, matchesFeature));
    const handle: MapLayerHandle = {
      ...base,
      ...properties,
      getMetadata: () => ({ ...base.getMetadata?.(), ...properties.getMetadata() }),
    };
    return {
      id: config.id,
      layer: vectorLayer,
      handle,
      writableTarget:
        source.type === 'inline'
          ? { id: config.id, layer: vectorLayer, source: vectorSource, data: dataSet, projection }
          : undefined,
    };
  } catch (error) {
    try {
      await resources.dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Could not create or clean up the GeoJSON layer',
        { cause: error }
      );
    }
    throw error;
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
