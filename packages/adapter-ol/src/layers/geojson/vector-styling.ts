import type {
  EngineLayerPatch,
  LayerCapabilities,
  LayerConfig,
  LegendItem,
  LegendValue,
} from '@joinmap/gis-core';
import Feature from 'ol/Feature.js';
import type VectorLayer from 'ol/layer/Vector.js';
import Style from 'ol/style/Style.js';
import Stroke from 'ol/style/Stroke.js';
import Fill from 'ol/style/Fill.js';
import CircleStyle from 'ol/style/Circle.js';
import { asArray as parseColor } from 'ol/color.js';
import { findVectorFeature } from '../../interactions/feature-reference.js';
import {
  defaultVectorStyle,
  resolveSingleSymbolLegend,
  validateLegendColors,
} from '../common/layer-legend.js';

type StyleOptions = typeof defaultVectorStyle & NonNullable<LayerConfig['style']>;
type VectorLegend = LayerConfig['legend'];

const lineDashes = { dashed: [8, 5], dotted: [1, 4] };

export function validateVectorStyle(style: LayerConfig['style']): void {
  const options = { ...defaultVectorStyle, ...style };
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
}

function makeStyle(options: StyleOptions): Style {
  const { fillOpacity = 1, lineDash = 'solid', lineCap } = options;
  const rgba = fillOpacity === 1 ? options.fillColor : [...parseColor(options.fillColor)];
  if (typeof rgba !== 'string') {
    rgba[3] = (rgba[3] ?? 1) * fillOpacity;
  }
  const fill = new Fill({ color: rgba });
  const stroke = new Stroke({
    color: options.strokeColor,
    width: options.strokeWidth,
    lineCap,
    lineDash: lineDash === 'solid' ? undefined : [...lineDashes[lineDash]],
  });
  return new Style({
    fill,
    stroke,
    image: new CircleStyle({ radius: options.pointRadius, fill, stroke }),
  });
}

function createLegendRules(legend: VectorLegend) {
  const categories = new Map<LegendValue, LegendItem>();
  if (legend?.type === 'category') {
    for (const item of legend.items ?? []) {
      for (const value of item.values ?? []) {
        categories.set(value, item);
      }
    }
  }
  function rules() {
    if (legend?.field && legend.type === 'category') {
      return legend.items ?? [];
    }
    if (legend?.field && legend.type === 'interval') {
      return legend.ranges ?? [];
    }
    return [];
  }
  function ruleFor(feature: Feature) {
    if (!legend?.field) {
      return undefined;
    }
    const value: unknown = feature.get(legend.field);
    if (value === null || value === undefined) {
      return legend.noData;
    }
    if (legend.type === 'category') {
      return categories.get(value as LegendValue);
    }
    if (legend.type === 'interval' && typeof value === 'number' && Number.isFinite(value)) {
      return legend.ranges?.find(
        (range) =>
          value >= range.min && (value < range.max || (range.includeMax && value === range.max))
      );
    }
  }
  return { rules: rules(), ruleFor };
}

function prepareVectorStyle(style: StyleOptions, legend: VectorLegend) {
  validateVectorStyle(style);
  validateLegendColors(legend);
  const baseStyle = makeStyle(style);
  const colors = new Map<string, Style>();
  const { ruleFor, rules } = createLegendRules(legend);
  return {
    style,
    legend,
    baseStyle,
    ruleFor,
    rules,
    styleFor(feature: Feature, color: string | undefined) {
      if (!color) {
        return baseStyle;
      }
      const line = /LineString$/.test(feature.getGeometry()?.getType() ?? '');
      const key = (line ? 'line:' : 'fill:') + color;
      let cached = colors.get(key);
      if (!cached) {
        cached = makeStyle({ ...style, [line ? 'strokeColor' : 'fillColor']: color });
        colors.set(key, cached);
      }
      return cached;
    },
  };
}

export function createVectorStyling(layer: VectorLayer, config: LayerConfig) {
  let render = prepareVectorStyle(
    { ...defaultVectorStyle, ...config.style },
    config.legend ? JSON.parse(JSON.stringify(config.legend)) : undefined
  );
  let legendFilter: string | undefined;
  let featureFilter: ((feature: Feature) => boolean) | undefined;

  const matchesTime = (feature: Feature) => !featureFilter || featureFilter(feature);
  const matchesFeature = (feature: Feature) =>
    matchesTime(feature) &&
    (legendFilter === undefined || render.ruleFor(feature)?.id === legendFilter);
  const applyVectorStyle = () => {
    if (legendFilter !== undefined && !render.rules.some(({ id }) => id === legendFilter)) {
      legendFilter = undefined;
    }
    if (render.legend?.field || featureFilter) {
      layer.setStyle((feature) => {
        if (!(feature instanceof Feature) || !matchesTime(feature)) {
          return undefined;
        }
        const rule = render.ruleFor(feature);
        if (legendFilter !== undefined && rule?.id !== legendFilter) {
          return undefined;
        }
        return render.styleFor(feature, rule?.color);
      });
    } else {
      layer.setStyle(render.baseStyle);
    }
  };

  const styling: LayerCapabilities['styling'] = {
    getStyle: () => Object.freeze({ ...render.style }),
  };
  const legendCapability: LayerCapabilities['legend'] = {
    supportsLegendFilter: () => render.rules.length > 0,
    getLegendFilter: () => legendFilter,
    setLegendFilter: (ruleId) => {
      if (ruleId !== undefined && !render.rules.some(({ id }) => id === ruleId)) {
        throw new Error(`Unknown legend rule "${ruleId}".`);
      }
      legendFilter = ruleId;
      layer.changed();
    },
    resolveLegend: (value) => resolveSingleSymbolLegend(value, render.style),
  };

  return {
    styling,
    legend: legendCapability,
    feature: {
      canSelectFeature(reference) {
        const feature = findVectorFeature(layer.getSource(), reference);
        return feature ? matchesFeature(feature) : reference.featureKey === undefined;
      },
    } satisfies LayerCapabilities['feature'],
    matchesFeature,
    apply: applyVectorStyle,
    prepareUpdate(patch: EngineLayerPatch) {
      if (patch.style === undefined && patch.legend === undefined) {
        return undefined;
      }
      const previous = render;
      const next = prepareVectorStyle(
        patch.style === undefined ? previous.style : { ...defaultVectorStyle, ...patch.style },
        patch.legend === undefined ? previous.legend : (patch.legend ?? undefined)
      );
      const previousFilter = legendFilter;
      const previousLayerStyle = layer.getStyle();
      return {
        apply() {
          render = next;
          applyVectorStyle();
        },
        rollback() {
          render = previous;
          legendFilter = previousFilter;
          layer.setStyle(previousLayerStyle);
        },
      };
    },
    setTimePredicate(filter: ((feature: Feature) => boolean) | undefined) {
      featureFilter = filter;
      applyVectorStyle();
      layer.changed();
    },
  };
}
