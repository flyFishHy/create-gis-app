import Feature, { type FeatureLike } from 'ol/Feature.js'
import type VectorSource from 'ol/source/Vector.js'
import { getUid } from 'ol/util.js'
import type { FeatureReference } from '@joinmap/gis-core'

/** Private bridge for adapter-owned vector layers outside LayerService. */
export const featureReferenceKey = 'gisFeatureReference'
export type FeatureReferenceResolver = (feature: Feature) => FeatureReference | undefined

export function describeFeature(feature: FeatureLike, layerId: string): FeatureReference {
  const properties = { ...feature.getProperties() }
  if (feature instanceof Feature) {
    delete properties[feature.getGeometryName()]
    return {
      layerId,
      id: feature.getId(),
      featureKey: getUid(feature),
      geometryType: feature.getGeometry()?.getType(),
      properties,
    }
  }
  return { layerId, id: feature.getId(), geometryType: feature.getType(), properties }
}

export function findVectorFeature(
  source: VectorSource<FeatureLike> | null,
  reference: FeatureReference
): Feature | undefined {
  const { featureKey, id } = reference
  const feature =
    featureKey !== undefined
      ? source?.getFeatureByUid(featureKey)
      : id === undefined
        ? undefined
        : source?.getFeatureById(id)
  return feature instanceof Feature ? feature : undefined
}
