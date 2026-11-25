import type { AppContext, LayerConfig, SearchResult, Unsubscribe } from '@joinmap/gis-core';
import type Feature from 'ol/Feature.js';
import type VectorSource from 'ol/source/Vector.js';
import type Projection from 'ol/proj/Projection.js';
import { describeFeature } from '../../interactions/feature-reference.js';

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function matchesTerm(feature: Feature, term: string): boolean {
  const id = feature.getId();
  if (id !== undefined && String(id).toLocaleLowerCase().includes(term)) {
    return true;
  }
  const geometryName = feature.getGeometryName();
  for (const key of feature.getKeys()) {
    if (key === geometryName) {
      continue;
    }
    const value: unknown = feature.get(key);
    if (isScalar(value) && String(value).toLocaleLowerCase().includes(term)) {
      return true;
    }
  }
  return false;
}

function hasDisplayValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim().length > 0;
}

export function registerVectorSearch(
  context: Pick<AppContext, 'layers' | 'search'>,
  config: Pick<LayerConfig, 'id' | 'title'>,
  vectorSource: VectorSource,
  projection: Projection,
  matchesFeature: (feature: Feature) => boolean
): Unsubscribe {
  return context.search.registerProvider({
    id: `ol-geojson:${config.id}`,
    layerIds: [config.id],
    async search({ keyword, signal }) {
      const term = keyword.trim().toLocaleLowerCase();
      if (!term) {
        return [];
      }
      const results: SearchResult[] = [];
      for (const feature of vectorSource.getFeatures()) {
        signal?.throwIfAborted();
        if (!matchesFeature(feature) || !matchesTerm(feature, term)) {
          continue;
        }
        const reference = describeFeature(feature, config.id);
        const properties = reference.properties ?? {};
        const extent = feature.getGeometry()?.getExtent();
        const location = extent?.every(Number.isFinite)
          ? extent[0] === extent[2] && extent[1] === extent[3]
            ? { coordinate: [extent[0]!, extent[1]!] as [number, number] }
            : {
                extent: [extent[0]!, extent[1]!, extent[2]!, extent[3]!] as [
                  number,
                  number,
                  number,
                  number,
                ],
              }
          : {};
        const title =
          [properties.name, properties.title, properties.label].find(hasDisplayValue) ??
          Object.values(properties).find((value) => isScalar(value) && hasDisplayValue(value)) ??
          (hasDisplayValue(reference.id) ? reference.id : undefined);
        results.push({
          id: `${config.id}:${reference.id ?? reference.featureKey}`,
          layerId: config.id,
          feature: reference,
          title: String(title ?? config.title ?? config.id),
          subtitle: context.layers.get(config.id)?.title ?? config.title,
          projection: projection.getCode(),
          ...location,
        });
        if (results.length >= 50) {
          break;
        }
      }
      return results;
    },
  });
}
