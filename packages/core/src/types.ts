export type {
  LayerConfig,
  LayerField,
  LayerInstance,
  LayerLegend,
  LayerService,
  LayerStyle,
  LayerTimeDimension,
  LayerTimeFilter,
  LayerTreeItem,
  LayerTypeDefinition,
  LayerUpdate,
} from './types/layer.js';
export type { EngineLayerPatch, LayerCapabilities, MapLayerHandle } from './types/layer-handle.js';
export type {
  LegendDefinition,
  LegendItem,
  LegendRange,
  LegendStop,
  LegendValue,
} from './types/legend.js';

// Compatibility exports: consumers continue importing from types.ts or the package root.
export type {
  AppStatus,
  JsonPrimitive,
  JsonValue,
  ReadonlyJsonValue,
  DeepReadonly,
  Unsubscribe,
} from './types/common.js';
export type { GISAppConfig, GISAppOptions, GISApp, AppContext } from './types/app.js';
export type { GISPlugin, PluginInstance, ResourceScope } from './types/plugin.js';
export type {
  MapStateSnapshot,
  LayerStateSnapshot,
  DataStateSnapshot,
  AppStateSnapshot,
  AppState,
  StateContributor,
} from './types/state.js';
export type {
  PanelPosition,
  UIThemeConfig,
  UIConfig,
  UITimePickerConfig,
  PanelDescriptor,
  PanelConfig,
  UIAdapter,
} from './types/ui.js';
export type {
  MapConfig,
  MapViewService,
  MapAdapter,
  MapService,
  MapLocation,
  MapOverlayAnchor,
} from './types/map.js';
export type {
  DataSourceConfig,
  DataLoadOptions,
  DataSet,
  DataService,
  DataProcessor,
} from './types/data.js';
export type {
  FeatureReference,
  SelectOptions,
  ToolDefinition,
  InteractionService,
  LayerIdentifyQuery,
  LayerIdentifyHit,
  FeaturePickCandidate,
  FeaturePickState,
  MapFeaturePick,
} from './types/interaction.js';
export type { GISAppEvents, EventService } from './types/events.js';
export type { SearchResult, SearchQuery, SearchProvider, SearchService } from './types/search.js';
export type { GISRuntimeErrorCode } from './errors.js';
export { GISRuntimeError } from './errors.js';
