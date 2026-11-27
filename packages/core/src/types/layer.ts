import type { JsonValue, Unsubscribe } from './common.js';
import type { MapLocation } from './map.js';
import type { AppContext } from './app.js';
import type { FeaturePickCandidate, FeatureReference, LayerIdentifyQuery } from './interaction.js';
import type { LegendDefinition, LegendValue } from './legend.js';
import type { MapLayerHandle } from './layer-handle.js';

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
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly zIndex: number;
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
  /** Validate or normalize the adapter-specific fields before any layer factory runs. */
  normalize?(config: LayerConfig): LayerConfig;
  create(context: AppContext, config: LayerConfig): MapLayerHandle | Promise<MapLayerHandle>;
}

export interface LayerTreeItem {
  readonly id: string;
  readonly kind: 'group' | 'leaf';
  readonly parentId: string | null;
  readonly children: readonly LayerTreeItem[];
}

export interface LayerService {
  getTree(): readonly LayerTreeItem[];
  getChildren(id: string): readonly LayerInstance[];
  getLeaves(id: string): readonly LayerInstance[];
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
