import type { DataSet, JsonValue, MapLayerHandle } from '@joinmap/gis-core';
import type BaseLayer from 'ol/layer/Base.js';
import type VectorLayer from 'ol/layer/Vector.js';
import type VectorSource from 'ol/source/Vector.js';
import type Projection from 'ol/proj/Projection.js';

export interface WritableVectorTarget {
  readonly id: string;
  readonly layer: VectorLayer<VectorSource>;
  readonly source: VectorSource;
  readonly data: DataSet<JsonValue>;
  readonly projection: Projection;
}

export interface LayerBinding {
  readonly id: string;
  readonly layer: BaseLayer;
  readonly handle: MapLayerHandle;
  readonly writableTarget?: WritableVectorTarget;
}
