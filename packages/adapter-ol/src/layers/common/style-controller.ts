import type { LayerConfig, LayerUpdate, LegendValue, MapLayerHandle } from '@joinmap/gis-core';
import Feature from 'ol/Feature.js';
import type BaseLayer from 'ol/layer/Base.js';
import VectorLayer from 'ol/layer/Vector.js';
import Style from 'ol/style/Style.js';
import Stroke from 'ol/style/Stroke.js';
import Fill from 'ol/style/Fill.js';
import CircleStyle from 'ol/style/Circle.js';
import { asArray as parseColor } from 'ol/color.js';

export function createLayerStyling(layer: BaseLayer, config: LayerConfig) {
  const defaults = {
    fillColor: '#ffffff66',
    strokeColor: '#3399cc',
    strokeWidth: 1.25,
    pointRadius: 5,
  };
  let styleOptions = { ...defaults, ...config.style };
  let legend: LayerConfig['legend'] = config.legend
    ? JSON.parse(JSON.stringify(config.legend))
    : undefined;
  let legendFilter: string | undefined;
  let featureFilter: ((feature: Feature) => boolean) | undefined;
  let vectorStyle: Style;
  const colors = new Map<string, Style>();
  const enumRules = new Map<LegendValue, { id: string; color?: string }>();
  const makeStyle = (options: typeof styleOptions) => {
    const { fillOpacity = 1, lineDash, lineCap } = options;
    const color = options.fillColor;
    const rgba = fillOpacity === 1 ? color : [...parseColor(color)];
    if (typeof rgba !== 'string') {
      rgba[3] = (rgba[3] ?? 1) * fillOpacity;
    }
    const fill = new Fill({ color: rgba });
    const stroke = new Stroke({
      color: options.strokeColor,
      width: options.strokeWidth,
      lineCap,
      lineDash: lineDash === 'dashed' ? [8, 5] : lineDash === 'dotted' ? [1, 4] : undefined,
    });
    return new Style({
      fill,
      stroke,
      image: new CircleStyle({ radius: options.pointRadius, fill, stroke }),
    });
  };
  const validateStyle = (options: typeof defaults) => {
    parseColor(options.fillColor);
    parseColor(options.strokeColor);
    if (
      !Number.isFinite(options.strokeWidth) ||
      options.strokeWidth <= 0 ||
      !Number.isFinite(options.pointRadius) ||
      options.pointRadius <= 0
    ) {
      throw new Error('Style sizes must be positive.');
    }
  };
  const validateLegend = (value: typeof legend) => {
    if (value?.field && !(layer instanceof VectorLayer)) {
      throw new Error('Field-based legend rules require a vector layer.');
    }
    for (const item of value?.items ?? []) {
      if (item.color) {
        parseColor(item.color);
      }
    }
    for (const range of value?.ranges ?? []) {
      parseColor(range.color);
    }
    if (value?.noData?.color) {
      parseColor(value.noData.color);
    }
  };
  const ruleFor = (feature: Feature) => {
    if (!legend?.field) {
      return undefined;
    }
    const value: unknown = feature.get(legend.field);
    if (value === null || value === undefined) {
      return legend.noData;
    }
    if (legend.type === 'category') {
      return enumRules.get(value as LegendValue);
    }
    if (legend.type === 'interval' && typeof value === 'number' && Number.isFinite(value)) {
      return legend.ranges?.find(
        (range) =>
          value >= range.min && (value < range.max || (range.includeMax && value === range.max))
      );
    }
  };
  const rules = () =>
    legend?.field && legend.type === 'category'
      ? (legend.items ?? [])
      : legend?.field && legend.type === 'interval'
        ? (legend.ranges ?? [])
        : [];
  const matchesLegend = (feature: Feature) =>
    legendFilter === undefined || ruleFor(feature)?.id === legendFilter;
  const matchesTime = (feature: Feature) => !featureFilter || featureFilter(feature);
  const matchesFeature = (feature: Feature) => matchesTime(feature) && matchesLegend(feature);
  const featureStyle = (feature: Feature) => {
    if (!matchesTime(feature)) {
      return undefined;
    }
    const rule = ruleFor(feature);
    if (legendFilter !== undefined && rule?.id !== legendFilter) {
      return undefined;
    }
    const color = rule?.color;
    if (!color) {
      return vectorStyle;
    }
    const line = /LineString$/.test(feature.getGeometry()?.getType() ?? '');
    const key = (line ? 'line:' : 'fill:') + color;
    let style = colors.get(key);
    if (!style) {
      style = makeStyle({ ...styleOptions, [line ? 'strokeColor' : 'fillColor']: color });
      colors.set(key, style);
    }
    return style;
  };
  const applyVectorStyle = () => {
    if (!(layer instanceof VectorLayer)) {
      return;
    }
    vectorStyle = makeStyle(styleOptions);
    colors.clear();
    enumRules.clear();
    if (legend?.type === 'category') {
      for (const item of legend.items ?? []) {
        for (const value of item.values ?? []) {
          enumRules.set(value, item);
        }
      }
    }
    if (legendFilter !== undefined && !rules().some((rule) => rule.id === legendFilter)) {
      legendFilter = undefined;
    }
    layer.setStyle(
      legend?.field || featureFilter
        ? (feature) => (feature instanceof Feature ? featureStyle(feature) : undefined)
        : vectorStyle
    );
  };
  if (config.style && !(layer instanceof VectorLayer)) {
    throw new Error('style requires a vector layer.');
  }
  validateStyle(styleOptions);
  validateLegend(legend);

  const methods: Pick<
    MapLayerHandle,
    'getStyle' | 'supportsLegendFilter' | 'getLegendFilter' | 'setLegendFilter' | 'resolveLegend'
  > = {
    getStyle: () => (layer instanceof VectorLayer ? Object.freeze({ ...styleOptions }) : undefined),
    supportsLegendFilter: () => layer instanceof VectorLayer && rules().length > 0,
    getLegendFilter: () => legendFilter,
    setLegendFilter: (ruleId) => {
      if (ruleId !== undefined && !rules().some((rule) => rule.id === ruleId)) {
        throw new Error(`Unknown legend rule "${ruleId}".`);
      }
      legendFilter = ruleId;
      layer.changed();
    },
    resolveLegend: (value) =>
      !value.field && value.useLayerStyle && value.type === 'category' && value.items?.length === 1
        ? {
            ...value,
            items: value.items.map((item) => ({
              ...item,
              color: item.symbol === 'line' ? styleOptions.strokeColor : styleOptions.fillColor,
            })),
          }
        : value,
  };

  return {
    methods,
    matchesFeature,
    apply: applyVectorStyle,
    prepareUpdate(patch: LayerUpdate) {
      if (patch.style && !(layer instanceof VectorLayer)) {
        throw new Error('style requires a vector layer.');
      }
      const nextStyle = patch.style === undefined ? styleOptions : { ...defaults, ...patch.style };
      const nextLegend = patch.legend === undefined ? legend : (patch.legend ?? undefined);
      validateStyle(nextStyle);
      validateLegend(nextLegend);
      return () => {
        styleOptions = nextStyle;
        legend = nextLegend;
        applyVectorStyle();
      };
    },
    setTimePredicate(filter: ((feature: Feature) => boolean) | undefined) {
      featureFilter = filter;
      applyVectorStyle();
      layer.changed();
    },
  };
}
