export { createOLAdapter, createOLLayerHandle, useOLMap } from './ol-adapter.js';
export type {
  OLLayerHandleOptions,
  PreparedLayerUpdate,
} from './layers/common/create-layer-handle.js';
export type {
  GeoJSONLayerConfig,
  OLLayerConfig,
  WMSLayerConfig,
  WMTSLayerConfig,
  XYZLayerConfig,
} from './layers/ol-layer-config.js';
export type { OLAdapterOptions } from './ol-adapter.js';

export { useOLTools } from './tools/install-ol-tools.js';
export type { OLToolsController } from './tools/install-ol-tools.js';
export { olTools } from './tools/tool-definitions.js';
export type { OLToolResult } from './tools/tool-definitions.js';
