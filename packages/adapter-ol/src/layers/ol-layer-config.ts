import { GISRuntimeError } from '@joinmap/gis-core';
import type { JsonValue, LayerConfig } from '@joinmap/gis-core';
import { validateOLOptions, validateStaticLegend } from './common/create-layer-handle.js';
import { validateLegendColors } from './common/layer-legend.js';
import { validateVectorStyle } from './geojson/vector-styling.js';

type OpacityOptions = { readonly opacity?: number };
type RasterConfig<Type extends string, Source> = Omit<
  LayerConfig,
  'type' | 'source' | 'options' | 'style' | 'children'
> & {
  readonly type: Type;
  readonly source: Source;
  readonly options?: OpacityOptions;
  readonly style?: never;
  readonly children?: never;
};

type URLSource = { readonly url: string };
export type XYZLayerConfig = RasterConfig<'xyz', URLSource>;
export type WMSLayerConfig = RasterConfig<
  'wms',
  URLSource & {
    readonly params: Readonly<Record<string, string | number | boolean>> & {
      readonly LAYERS: string;
    };
  }
>;
export type WMTSLayerConfig = RasterConfig<
  'wmts',
  URLSource & { readonly layer: string; readonly matrixSet: string }
>;
export type GeoJSONLayerConfig = Omit<LayerConfig, 'type' | 'source' | 'options' | 'children'> & {
  readonly type: 'geojson';
  readonly options?: OpacityOptions;
  readonly children?: never;
  readonly source:
    | { readonly type: 'inline'; readonly data: JsonValue }
    | { readonly type: 'url'; readonly url: string };
};
export type OLLayerConfig = XYZLayerConfig | WMSLayerConfig | WMTSLayerConfig | GeoJSONLayerConfig;

function invalid(path: string, message: string, cause?: unknown): never {
  throw new GISRuntimeError({ code: 'CONFIG_INVALID', message, detail: { path }, cause });
}

function object(value: JsonValue | undefined): Readonly<Record<string, JsonValue | undefined>> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function required(config: LayerConfig, value: JsonValue | undefined, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    return invalid(path, `Layer "${config.id}" requires ${path}.`);
  }
  return value;
}

function validateAppearance(config: LayerConfig, vector = false): void {
  try {
    if (config.options) {
      validateOLOptions(config.options);
    }
  } catch (cause) {
    invalid('options', cause instanceof Error ? cause.message : 'Invalid OL options.', cause);
  }
  if (vector) {
    try {
      validateVectorStyle(config.style);
    } catch (cause) {
      invalid('style', cause instanceof Error ? cause.message : 'Invalid vector style.', cause);
    }
  } else if (config.style) {
    invalid('style', 'style requires a vector layer.');
  }
  try {
    if (vector) {
      validateLegendColors(config.legend);
    } else {
      validateStaticLegend(config);
    }
  } catch (cause) {
    invalid('legend', cause instanceof Error ? cause.message : 'Invalid OL legend.', cause);
  }
}

export function normalizeXYZConfig(config: LayerConfig): XYZLayerConfig {
  const source = object(config.source);
  const url = required(config, source.url, 'source.url');
  validateAppearance(config);
  return {
    ...config,
    type: 'xyz',
    source: { ...source, url },
    style: undefined,
    children: undefined,
  };
}

export function normalizeWMSConfig(config: LayerConfig): WMSLayerConfig {
  const source = object(config.source);
  const url = required(config, source.url, 'source.url');
  const params = object(source.params);
  const LAYERS = required(config, params.LAYERS, 'source.params.LAYERS');
  const scalars = Object.fromEntries(
    Object.entries(params).map(([key, value]) => {
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        invalid(
          `source.params.${key}`,
          `Layer "${config.id}" requires a scalar value for source.params.${key}.`
        );
      }
      return [key, value] as const;
    })
  );
  validateAppearance(config);
  return {
    ...config,
    type: 'wms',
    source: { ...source, url, params: { ...scalars, LAYERS } },
    style: undefined,
    children: undefined,
  };
}

export function normalizeWMTSConfig(config: LayerConfig): WMTSLayerConfig {
  const source = object(config.source);
  const url = required(config, source.url, 'source.url');
  const layer = required(config, source.layer, 'source.layer');
  const matrixSet = required(config, source.matrixSet, 'source.matrixSet');
  validateAppearance(config);
  return {
    ...config,
    type: 'wmts',
    source: { ...source, url, layer, matrixSet },
    style: undefined,
    children: undefined,
  };
}

export function normalizeGeoJSONConfig(config: LayerConfig): GeoJSONLayerConfig {
  const source = object(config.source);
  validateAppearance(config, true);
  const common = { ...config, type: 'geojson' as const, children: undefined };
  if (source.type === 'url') {
    return {
      ...common,
      source: { ...source, type: 'url', url: required(config, source.url, 'source.url') },
    };
  }
  if (source.type === 'inline') {
    if (source.data === undefined) {
      invalid('source.data', 'Inline data source requires data.');
    }
    return { ...common, source: { ...source, type: 'inline', data: source.data } };
  }
  return invalid('source.type', `Layer "${config.id}" requires a URL or inline data source.`);
}
