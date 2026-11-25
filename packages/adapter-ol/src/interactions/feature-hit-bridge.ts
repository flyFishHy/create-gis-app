import type { FeaturePickCandidate, GISApp, Unsubscribe } from '@joinmap/gis-core';
import Feature, { type FeatureLike } from 'ol/Feature.js';
import type OlMap from 'ol/Map.js';
import type BaseLayer from 'ol/layer/Base.js';
import { inView } from 'ol/layer/Layer.js';
import { containsCoordinate } from 'ol/extent.js';
import { fromUserCoordinate } from 'ol/proj.js';
import { unByKey } from 'ol/Observable.js';
import {
  describeFeature,
  featureReferenceKey,
  type FeatureReferenceResolver,
} from './feature-reference.js';

export function installFeaturePicking(
  map: OlMap,
  app: Pick<GISApp, 'interactions' | 'layers'>,
  highlightLayer: BaseLayer
): Unsubscribe {
  const click = map.on('singleclick', (event) => {
    if (app.interactions.getActiveTool()) {
      return;
    }
    const candidates: FeaturePickCandidate[] = [];
    const seen = new Map<string, Set<FeatureLike | string | number>>();
    const hitLayerIds = new Map<BaseLayer, string>();
    map.forEachFeatureAtPixel(
      event.pixel,
      (feature, layer) => {
        if (!layer) {
          return;
        }
        const candidate = resolveHit(app, feature, layer);
        if (!candidate) {
          return;
        }
        let features = seen.get(candidate.layerId);
        if (!features) {
          features = new Set();
          seen.set(candidate.layerId, features);
        }
        const key = candidate.id ?? feature;
        if (features.has(key)) {
          return;
        }
        features.add(key);
        hitLayerIds.set(layer, candidate.layerId);
        candidates.push(candidate);
      },
      { layerFilter: (layer) => layer !== highlightLayer }
    );

    const view = map.getView(),
      projection = view.getProjection(),
      resolution = view.getResolution();
    const coordinate = event.coordinate && fromUserCoordinate(event.coordinate, projection);
    const location =
      coordinate && resolution !== undefined
        ? {
            coordinate: [coordinate[0]!, coordinate[1]!] as [number, number],
            projection: projection.getCode(),
            resolution,
          }
        : undefined;
    const viewState = location && view.getState();
    const layerIds = location
      ? map
          .getLayerGroup()
          .getLayerStatesArray()
          .sort((leftLayer, rightLayer) => (leftLayer.zIndex ?? 0) - (rightLayer.zIndex ?? 0))
          .reverse()
          .flatMap((state) => {
            const id =
              hitLayerIds.get(state.layer) ?? (state.layer.get('gisLayerId') as string | undefined);
            return id &&
              viewState &&
              inView(state, viewState) &&
              (!state.extent || containsCoordinate(state.extent, location.coordinate))
              ? [id]
              : [];
          })
      : [];
    void app.interactions.pickFeatures({
      pixel: [event.pixel[0]!, event.pixel[1]!],
      location,
      layerIds,
      candidates,
    });
  });
  const movement = map.on(['pointerdrag', 'movestart', 'change:size'], () =>
    app.interactions.cancelFeaturePick({ preserveAnchoredChoices: true })
  );
  const view = map.on('change:view', () => app.interactions.cancelFeaturePick());
  const stopLayerChanges = app.layers.subscribe(() => {
    const selection = app.interactions.getSelection();
    if (
      selection &&
      (!selection.source || selection.source === 'layer') &&
      !app.layers.get(selection.layerId)?.visible
    ) {
      app.interactions.clearSelection();
    }
  });
  return () => {
    unByKey([click, ...movement, view]);
    stopLayerChanges();
  };
}

function resolveHit(
  app: Pick<GISApp, 'layers'>,
  feature: FeatureLike,
  layer: BaseLayer
): FeaturePickCandidate | undefined {
  const resolve = layer.get(featureReferenceKey) as FeatureReferenceResolver | undefined;
  if (resolve && feature instanceof Feature) {
    return resolve(feature);
  }
  const layerId = layer.get('gisLayerId') as string | undefined;
  if (!layerId || !app.layers.get(layerId)?.visible) {
    return;
  }
  return describeFeature(feature, layerId);
}
