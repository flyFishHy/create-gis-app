import type {
  AppContext,
  DataSet,
  JsonValue,
  LayerTimeDimension,
  LayerTimeFilter,
  ResourceScope,
} from '@joinmap/gis-core';
import type GeoJSON from 'ol/format/GeoJSON.js';
import type VectorSource from 'ol/source/Vector.js';

export function bindVectorData(
  context: Pick<AppContext, 'layers' | 'interactions'>,
  layerId: string,
  dataSet: DataSet<JsonValue>,
  vectorSource: VectorSource,
  format: GeoJSON,
  time: {
    getTimeDimensions(): readonly LayerTimeDimension[];
    getTimeFilter(): LayerTimeFilter | undefined;
  },
  resources: ResourceScope
): void {
  const unvalidate = dataSet.validate((data) => {
    format.readFeatures(data as Record<string, unknown>);
  });
  resources.add(unvalidate);
  const unsubscribe = dataSet.subscribe((data) => {
    const next = format.readFeatures(data as Record<string, unknown>);
    vectorSource.clear();
    vectorSource.addFeatures(next);
    const selected = context.interactions.getSelection();
    if (selected?.layerId === layerId && (!selected.source || selected.source === 'layer')) {
      context.interactions.clearSelection();
    }
    // Re-apply the optional filter and publish a layer revision after the
    // source changes so time dimensions and data-derived extents update UI.
    const previousFilter = time.getTimeFilter();
    const nextFilter =
      previousFilter &&
      time.getTimeDimensions().some((dimension) => dimension.field === previousFilter.field)
        ? previousFilter
        : undefined;
    context.layers.get(layerId)?.setTimeFilter(nextFilter);
  });
  resources.add(unsubscribe);
}
