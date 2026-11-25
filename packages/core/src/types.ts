import type { JsonValue, Unsubscribe } from './types/common.js';
import type { MapLocation } from './types/map.js';
import type { AppContext } from './types/app.js';
import type {
  FeaturePickCandidate,
  FeatureReference,
  LayerIdentifyHit,
  LayerIdentifyQuery,
} from './types/interaction.js';

/** Map-domain legend description; contains no UI framework values. */
export interface LegendDefinition {
  readonly field?: string;
  readonly ranges?: readonly LegendRange[];
  /** Opt in to the layer's uniform style for a single category symbol. */
  readonly useLayerStyle?: boolean;
  readonly id: string;
  readonly layerId?: string;
  readonly title?: string;
  readonly type: 'category' | 'continuous' | 'interval' | 'image';
  readonly items?: readonly LegendItem[];
  readonly stops?: readonly LegendStop[];
  readonly noData?: LegendItem;
  readonly imageUrl?: string;
}

export type LegendValue = string | number | boolean;

export interface LegendItem {
  readonly values?: readonly LegendValue[];
  /** Legacy input only; normalization converts it to values. */
  readonly value?: string | number | boolean;
  readonly id: string;
  readonly label: string;
  readonly color?: string;
  readonly symbol?: 'fill' | 'line' | 'circle' | 'square';
  readonly visible?: boolean;
}

export interface LegendStop {
  readonly value: number;
  readonly color: string;
  readonly label?: string;
}

/** Numeric intervals are left-closed/right-open; includeMax opts in to a closed upper edge. */
export interface LegendRange {
  readonly id: string;
  readonly min: number;
  readonly max: number;
  readonly includeMax?: boolean;
  readonly label?: string;
  readonly color: string;
}

export interface LayerStyle {
  readonly fillColor?: string;
  readonly fillOpacity?: number;
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
  readonly lineDash?: 'solid' | 'dashed' | 'dotted';
  readonly lineCap?: 'round' | 'butt' | 'square';
  readonly pointRadius?: number;
}

export interface LayerField {
  readonly name: string;
  readonly type: 'string' | 'number' | 'boolean';
}

export interface LayerConfig {
  readonly style?: LayerStyle;
  readonly legend?: LayerLegend;
  readonly id: string;
  readonly type: string;
  readonly title?: string;
  readonly visible?: boolean;
  readonly zIndex?: number;
  readonly source?: JsonValue;
  readonly options?: Readonly<Record<string, JsonValue>>;
  readonly children?: readonly LayerConfig[];
}

export interface MapLayerHandle {
  identify?(
    query: LayerIdentifyQuery
  ): readonly LayerIdentifyHit[] | Promise<readonly LayerIdentifyHit[]>;
  canSelectFeature?(feature: FeatureReference): boolean;
  getStyle?(): LayerStyle | undefined;
  getFields?(): readonly LayerField[];
  getFieldValues?(field: string): readonly LegendValue[];
  /** Current finite data coverage, preferably in the current map projection. */
  getDataLocation?(): MapLocation | undefined;
  resolveLegend?(legend: LegendDefinition): LegendDefinition;
  getTimeDimensions?(): readonly LayerTimeDimension[];
  getTimeFilter?(): LayerTimeFilter | undefined;
  setTimeFilter?(filter: LayerTimeFilter | undefined): void;
  supportsLegendFilter?(): boolean;
  getLegendFilter?(): string | undefined;
  setLegendFilter?(ruleId: string | undefined): void;
  setVisible(visible: boolean): void;
  setZIndex(zIndex: number): void;
  /** Synchronously applies the entire patch, restoring previous engine state on failure. */
  commitUpdate?(patch: LayerUpdate): undefined;
  /** Legacy update hook. Core still applies the common visibility and order setters. */
  update?(patch: LayerUpdate): void | Promise<void>;
  dispose(): void | Promise<void>;
  getMetadata?(): Readonly<Record<string, unknown>>;
}

export interface LayerUpdate {
  readonly style?: LayerStyle;
  /** Checked inside the layer's update queue before applying any engine changes. */
  readonly expectedVersion?: number;
  readonly legend?: LayerLegend | null;
  readonly title?: string;
  readonly visible?: boolean;
  readonly zIndex?: number;
  readonly options?: Readonly<Record<string, JsonValue>>;
}

/** A discrete, UTC-normalized date/time field exposed by a layer adapter. */
export interface LayerTimeDimension {
  readonly field: string;
  readonly values: readonly number[];
}

/** Inclusive epoch-millisecond range applied to one layer date/time field. */
export interface LayerTimeFilter {
  readonly field: string;
  readonly start: number;
  readonly end: number;
}

export interface LayerInstance {
  readonly style: LayerStyle | undefined;
  getFields(): readonly LayerField[];
  getFieldValues(field: string): readonly LegendValue[];
  readonly version: number;
  readonly legend: LegendDefinition | undefined;
  readonly id: string;
  readonly type: string;
  readonly title?: string;
  readonly status: 'created' | 'loading' | 'ready' | 'error' | 'disposed';
  readonly visible: boolean;
  /** This layer's visibility setting before applying ancestor group gates. */
  readonly ownVisible: boolean;
  setVisibility(visible: boolean): void;
  getTimeDimensions(): readonly LayerTimeDimension[];
  getTimeFilter(): LayerTimeFilter | undefined;
  setTimeFilter(filter: LayerTimeFilter | undefined): void;
  supportsLegendFilter(): boolean;
  getLegendFilter(): string | undefined;
  setLegendFilter(ruleId: string | undefined): void;
  update(patch: LayerUpdate): Promise<void>;
  dispose(): Promise<void>;
  getMetadata(): Readonly<Record<string, unknown>>;
}

export interface LayerTypeDefinition {
  create(context: AppContext, config: LayerConfig): MapLayerHandle | Promise<MapLayerHandle>;
}

export interface LayerService {
  canSelectFeature(feature: FeatureReference): boolean;
  identify(
    id: string,
    query: LayerIdentifyQuery
  ): Promise<readonly FeaturePickCandidate[]> | undefined;
  getDataLocation(id: string): MapLocation | undefined;
  add(config: LayerConfig): Promise<LayerInstance>;
  addChild(groupId: string, config: LayerConfig): Promise<LayerInstance>;
  remove(id: string): Promise<void>;
  update(id: string, patch: LayerUpdate): Promise<void>;
  get(id: string): LayerInstance | undefined;
  has(id: string): boolean;
  list(): LayerInstance[];
  setVisibility(id: string, visible: boolean): void;
  setOrder(ids: string[]): void;
  clear(): Promise<void>;
  subscribe(
    listener: (event: {
      type: 'add' | 'remove' | 'update' | 'order' | 'visibility';
      id?: string;
      visible?: boolean;
    }) => void
  ): Unsubscribe;
}

export type LayerLegend = Omit<LegendDefinition, 'id' | 'layerId'> & { readonly id?: string };

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
