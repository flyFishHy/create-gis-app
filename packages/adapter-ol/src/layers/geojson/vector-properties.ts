import type {
  LayerField,
  LayerTimeDimension,
  LayerTimeFilter,
  LegendValue,
  MapLayerHandle,
  ResourceScope,
} from '@joinmap/gis-core';
import type Feature from 'ol/Feature.js';
import type VectorSource from 'ol/source/Vector.js';
import type Projection from 'ol/proj/Projection.js';
import { transformExtent } from 'ol/proj.js';
import { unByKey } from 'ol/Observable.js';

export function createVectorProperties(
  vectorSource: VectorSource,
  layerId: string,
  projection: Projection,
  getProjection: () => Projection,
  setTimePredicate: (predicate: ((feature: Feature) => boolean) | undefined) => void,
  resources: ResourceScope
) {
  let timeFilter: LayerTimeFilter | undefined;
  let cachedFields: readonly LayerField[] | undefined;
  let cachedFieldValues: { field: string; values: readonly LegendValue[] } | undefined;
  let cachedDimensions: readonly LayerTimeDimension[] | undefined;
  let cachedSummary:
    | {
        geometryType?: string;
        hasDataLocation: boolean;
        dimensions: {
          field: string;
          count: number;
          min: number | undefined;
          max: number | undefined;
        }[];
      }
    | undefined;
  const invalidateProperties = () => {
    cachedFields = undefined;
    cachedFieldValues = undefined;
    cachedDimensions = undefined;
    cachedSummary = undefined;
  };
  const changes = vectorSource.on('change', invalidateProperties);
  resources.add(() => {
    unByKey(changes);
    invalidateProperties();
  });
  const timeDimensions = (): readonly LayerTimeDimension[] =>
    (cachedDimensions ??= Object.freeze(detectTimeDimensions(vectorSource.getFeatures())));
  const matchesTimeFilter = (feature: Feature): boolean => {
    if (!timeFilter) {
      return true;
    }
    const value = timestampValue(feature.get(timeFilter.field), timeFilter.field);
    return value !== undefined && value >= timeFilter.start && value <= timeFilter.end;
  };
  const getFields: NonNullable<MapLayerHandle['getFields']> = () => {
    if (cachedFields) {
      return cachedFields;
    }
    const fields = new Map<string, LayerField['type']>();
    for (const feature of vectorSource.getFeatures()) {
      for (const [name, value] of Object.entries(feature.getProperties())) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          fields.set(name, typeof value as LayerField['type']);
        }
      }
    }
    cachedFields = Object.freeze(
      Array.from(fields, ([name, type]) => Object.freeze({ name, type }))
    );
    return cachedFields;
  };
  const getFieldValues: NonNullable<MapLayerHandle['getFieldValues']> = (field) => {
    if (cachedFieldValues?.field === field) {
      return cachedFieldValues.values;
    }
    const values = new Set<LegendValue>();
    for (const feature of vectorSource.getFeatures()) {
      const value: unknown = feature.get(field);
      if (
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
      ) {
        values.add(value);
      }
    }
    const snapshot = Object.freeze([...values]);
    cachedFieldValues = { field, values: snapshot };
    return snapshot;
  };
  const setTimeFilter: NonNullable<MapLayerHandle['setTimeFilter']> = (filter) => {
    if (filter) {
      const dimension = timeDimensions().find((item) => item.field === filter.field);
      if (!dimension) {
        throw new Error(`Layer "${layerId}" has no date/time field "${filter.field}".`);
      }
      timeFilter = Object.freeze({ ...filter });
    } else {
      timeFilter = undefined;
    }
    setTimePredicate(timeFilter ? matchesTimeFilter : undefined);
  };
  const getMetadata = () => {
    cachedSummary ??= {
      geometryType: vectorSource.getFeatures()[0]?.getGeometry()?.getType(),
      hasDataLocation: !!vectorSource.getExtent()?.every(Number.isFinite),
      dimensions: timeDimensions().map(({ field, values }) => ({
        field,
        count: values.length,
        min: values[0],
        max: values.at(-1),
      })),
    };
    return {
      geometryType: cachedSummary.geometryType,
      hasDataLocation: cachedSummary.hasDataLocation,
      time: {
        dimensions: cachedSummary.dimensions.map((item) => ({ ...item })),
        filter: timeFilter ? { ...timeFilter } : null,
      },
    };
  };
  const getDataLocation: NonNullable<MapLayerHandle['getDataLocation']> = () => {
    const extent = vectorSource.getExtent();
    if (!extent?.every(Number.isFinite)) {
      return undefined;
    }
    const target = getProjection();
    const bounds = transformExtent(extent, projection, target);
    return {
      extent: [bounds[0]!, bounds[1]!, bounds[2]!, bounds[3]!],
      projection: target.getCode(),
    };
  };

  return {
    getFields,
    getFieldValues,
    getTimeDimensions: timeDimensions,
    getTimeFilter: () => timeFilter && { ...timeFilter },
    setTimeFilter,
    getDataLocation,
    getMetadata,
  };
}

const DATE_FIELD = /(^|[_-])(date|time|datetime|timestamp|year)([_-]|$)/i;
const ISO_DATE =
  /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s]\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i;

function timestampValue(value: unknown, field: string): number | undefined {
  if (typeof value === 'string') {
    const input = value.trim();
    if (!ISO_DATE.test(input)) {
      return undefined;
    }
    const normalized = input.replaceAll('/', '-').replace(' ', 'T');
    const timestamp = Date.parse(
      /T/.test(normalized) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
        ? `${normalized}Z`
        : normalized
    );
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || !DATE_FIELD.test(field)) {
    return undefined;
  }
  if (Number.isInteger(value) && value >= 1000 && value <= 9999) {
    return Date.UTC(value, 0, 1);
  }
  if (Math.abs(value) >= 1e11) {
    return value;
  }
  if (Math.abs(value) >= 1e9) {
    return value * 1000;
  }
  return undefined;
}

function detectTimeDimensions(features: readonly Feature[]): readonly LayerTimeDimension[] {
  const fields = new Map<string, Set<number>>();
  for (const feature of features) {
    const properties = feature.getProperties();
    for (const [field, value] of Object.entries(properties)) {
      if (field === feature.getGeometryName()) {
        continue;
      }
      const timestamp = timestampValue(value, field);
      if (timestamp === undefined) {
        continue;
      }
      let values = fields.get(field);
      if (!values) {
        values = new Set();
        fields.set(field, values);
      }
      values.add(timestamp);
    }
  }
  return [...fields]
    .map(([field, values]) =>
      Object.freeze({
        field,
        values: Object.freeze([...values].sort((leftValue, rightValue) => leftValue - rightValue)),
      })
    )
    .sort(
      (leftField, rightField) =>
        Number(DATE_FIELD.test(rightField.field)) - Number(DATE_FIELD.test(leftField.field)) ||
        leftField.field.localeCompare(rightField.field)
    );
}
