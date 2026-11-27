import { ResourceScopeImpl } from '@joinmap/gis-core';
import type { AppContext, JsonValue, MapLayerHandle } from '@joinmap/gis-core';
import type { GeoJSONLayerConfig } from '../ol-layer-config.js';
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
import { createVectorStyling } from './vector-styling.js';

export async function createGeoJSONLayer(
  context: AppContext,
  config: GeoJSONLayerConfig,
  getProjection: () => Projection
): Promise<LayerBinding> {
  const source = config.source;
  const datasetId = `layer:${config.id}`;
  const resources = new ResourceScopeImpl();
  try {
    const dataSet = await loadOwnedDataSet<JsonValue>(
      context.data,
      resources,
      source.type === 'inline'
        ? { id: datasetId, type: 'inline', data: source.data }
        : { id: datasetId, type: 'url', url: source.url }
    );
    const projection = getProjection();
    const format = new GeoJSON({ featureProjection: projection });
    const features = format.readFeatures(dataSet.data as Record<string, unknown>);
    const vectorSource = new VectorSource({ features });
    resources.add(() => vectorSource.clear(true));
    const vectorLayer = new VectorLayer({ source: vectorSource });
    const vector = createVectorStyling(vectorLayer, config);
    vector.apply();
    const properties = createVectorProperties(
      vectorSource,
      config.id,
      projection,
      getProjection,
      vector.setTimePredicate,
      resources
    );
    bindVectorData(context, config.id, dataSet, vectorSource, format, properties, resources);
    resources.add(
      registerVectorSearch(context, config, vectorSource, projection, vector.matchesFeature)
    );
    const base = createLayerHandle(vectorLayer, config, {
      dispose: () => resources.dispose(),
      prepareUpdate: vector.prepareUpdate,
      capabilities: {
        styling: vector.styling,
        legend: vector.legend,
        feature: vector.feature,
        attributes: {
          getFields: properties.getFields,
          getFieldValues: properties.getFieldValues,
        },
        temporal: {
          getTimeDimensions: properties.getTimeDimensions,
          getTimeFilter: properties.getTimeFilter,
          setTimeFilter: properties.setTimeFilter,
        },
        location: { getDataLocation: properties.getDataLocation },
      },
    });
    const handle: MapLayerHandle = {
      ...base,
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
