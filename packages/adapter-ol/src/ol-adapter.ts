import type { AppContext, GISApp, GISPlugin, LayerConfig, MapLayerHandle } from '@joinmap/gis-core';
import { defineLayerType } from '@joinmap/gis-core';
import type OlMap from 'ol/Map.js';
import type BaseLayer from 'ol/layer/Base.js';
import VectorLayer from 'ol/layer/Vector.js';
import {
  createLayerHandle,
  type OLLayerHandleOptions,
} from './layers/common/create-layer-handle.js';
import { createVectorStyling } from './layers/geojson/vector-styling.js';
import { createGeoJSONLayer } from './layers/geojson/geojson-layer.js';
import { createWMSLayer } from './layers/wms/wms-layer.js';
import { createWMTSLayer } from './layers/wmts/wmts-layer.js';
import { createXYZLayer } from './layers/xyz/xyz-layer.js';
import {
  normalizeGeoJSONConfig,
  normalizeWMSConfig,
  normalizeWMTSConfig,
  normalizeXYZConfig,
} from './layers/ol-layer-config.js';
import { OLMapAdapter } from './map/ol-map-adapter.js';
import { installOLTools } from './tools/install-ol-tools.js';

export interface OLAdapterOptions {
  readonly tools?: boolean;
  readonly controls?: boolean;
  readonly zoomControl?: boolean;
  readonly interactions?: boolean;
  readonly projection?: string;
}

export function createOLAdapter(options: OLAdapterOptions = {}): GISPlugin {
  return {
    name: 'openlayers-adapter',
    install(app, _pluginOptions, resources) {
      const adapter = new OLMapAdapter(options, app);
      app.registerMapAdapter(adapter, resources);
      app.registerLayerType(
        'xyz',
        defineLayerType({
          normalize: normalizeXYZConfig,
          create: (_context, config) => adapter.layerCollection.trackLayer(createXYZLayer(config)),
        }),
        resources
      );
      app.registerLayerType(
        'wms',
        defineLayerType({
          normalize: normalizeWMSConfig,
          create: (_context, config) => adapter.layerCollection.trackLayer(createWMSLayer(config)),
        }),
        resources
      );
      app.registerLayerType(
        'wmts',
        defineLayerType({
          normalize: normalizeWMTSConfig,
          async create(context, config) {
            return adapter.layerCollection.trackLayer(await createWMTSLayer(context.data, config));
          },
        }),
        resources
      );
      app.registerLayerType(
        'geojson',
        defineLayerType({
          normalize: normalizeGeoJSONConfig,
          async create(context, config) {
            const binding = await createGeoJSONLayer(context, config, () =>
              adapter.getMap().getView().getProjection()
            );
            return adapter.layerCollection.trackLayer(binding);
          },
        }),
        resources
      );
      if (options.tools !== false) {
        installOLTools(app, resources, {
          getMap: () => adapter.getMap(),
          getWritableTarget: (id) => adapter.layerCollection.getWritableTarget(id),
        });
      }
    },
  };
}

export function useOLMap(app: GISApp): OlMap {
  return getOLAdapter(app).getMap();
}

/** Create a handle for a custom OL layer registered through LayerService. */
export function createOLLayerHandle(
  context: Pick<AppContext, 'map'>,
  layer: BaseLayer,
  config: LayerConfig,
  options: OLLayerHandleOptions = {}
): MapLayerHandle {
  const adapter = getOLAdapter(context);
  if (layer instanceof VectorLayer && !options.prepareUpdate) {
    const vector = createVectorStyling(layer, config);
    vector.apply();
    const handle = createLayerHandle(layer, config, {
      ...options,
      prepareUpdate: vector.prepareUpdate,
    });
    Object.assign(handle, vector.styling, vector.legend, vector.feature, {
      capabilities: options.capabilities,
    });
    return adapter.layerCollection.trackLayer({ id: config.id, layer, handle });
  }
  const handle = createLayerHandle(layer, config, options);
  return adapter.layerCollection.trackLayer({ id: config.id, layer, handle });
}

function getOLAdapter(context: Pick<AppContext, 'map'>): OLMapAdapter {
  const adapter = context.map.getAdapter();
  if (!(adapter instanceof OLMapAdapter)) {
    throw new Error('The registered Map Adapter is not OpenLayers.');
  }
  return adapter;
}
