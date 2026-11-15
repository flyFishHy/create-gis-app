import type Feature from 'ol/Feature.js'
import type { FeatureReference } from '@joinmap/gis-core'

/** Private bridge for adapter-owned vector layers outside LayerService. */
export const featureReferenceKey = 'gisFeatureReference'
export type FeatureReferenceResolver = (feature: Feature) => FeatureReference | undefined
