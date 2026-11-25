import type { JsonValue } from '@joinmap/gis-core';
import Feature from 'ol/Feature.js';
import type GeoJSON from 'ol/format/GeoJSON.js';
import type { WriteOptions } from 'ol/format/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { WritableVectorTarget } from '../layers/common/layer-binding.js';
import type { OLToolResult } from './tool-definitions.js';

export function writeToolFeatures(
  format: GeoJSON,
  options: WriteOptions,
  target: WritableVectorTarget,
  features: Feature[],
  removed: readonly string[]
): void {
  const data = target.data.data;
  const base =
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    data.type === 'FeatureCollection' &&
    Array.isArray(data.features)
      ? { ...data, type: 'FeatureCollection', features: data.features }
      : {
          type: 'FeatureCollection',
          features: format.writeFeaturesObject(target.source.getFeatures(), options)
            .features as unknown as JsonValue[],
        };
  const ids = new Set(removed);
  const existing = base.features.filter(
    (feature) =>
      !feature ||
      typeof feature !== 'object' ||
      Array.isArray(feature) ||
      typeof feature.id !== 'string' ||
      !ids.has(feature.id)
  );
  const additions = format.writeFeaturesObject(features, options)
    .features as unknown as JsonValue[];
  target.data.update({ ...base, features: [...existing, ...additions] });
}

export function createResultFeature(
  result: Omit<OLToolResult, 'geometry'>,
  geometry: Geometry
): Feature {
  const feature = new Feature({
    geometry,
    gisToolId: result.toolId,
    projection: result.projection,
  });
  if (result.value !== undefined) {
    feature.setProperties({ value: result.value, unit: result.unit });
  }
  feature.setId(result.id);
  return feature;
}
