import type { AppContext, GISApp, GISPlugin, LayerConfig, MapLayerHandle } from '@joinmap/gis-core';
import type OlMap from 'ol/Map.js';
import type BaseLayer from 'ol/layer/Base.js';
import { createLayerHandle } from './layers/common/create-layer-handle.js';
import { createGeoJSONLayer } from './layers/geojson/geojson-layer.js';
import { createWMSLayer } from './layers/wms/wms-layer.js';
import { createWMTSLayer } from './layers/wmts/wmts-layer.js';
import { createXYZLayer } from './layers/xyz/xyz-layer.js';
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
        {
          create: (_context, config) => adapter.layerCollection.trackLayer(createXYZLayer(config)),
        },
        resources
      );
      app.registerLayerType(
        'wms',
        {
          create: (_context, config) => adapter.layerCollection.trackLayer(createWMSLayer(config)),
        },
        resources
      );
      app.registerLayerType(
        'wmts',
        {
          async create(context, config) {
            return adapter.layerCollection.trackLayer(await createWMTSLayer(context.data, config));
          },
        },
        resources
      );
      app.registerLayerType(
        'geojson',
        {
          async create(context, config) {
            const binding = await createGeoJSONLayer(context, config, () =>
              adapter.getMap().getView().getProjection()
            );
            return adapter.layerCollection.trackLayer(binding);
          },
        },
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
  config: LayerConfig
): MapLayerHandle {
  const adapter = getOLAdapter(context);
  const { handle } = createLayerHandle(layer, config);
  return adapter.layerCollection.trackLayer({ id: config.id, layer, handle });
}

function getOLAdapter(context: Pick<AppContext, 'map'>): OLMapAdapter {
  const adapter = context.map.getAdapter();
  if (!(adapter instanceof OLMapAdapter)) {
    throw new Error('The registered Map Adapter is not OpenLayers.');
  }
  return adapter;
}
