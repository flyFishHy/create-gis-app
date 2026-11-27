import type {
  LayerField,
  LayerStyle,
  LayerTimeDimension,
  LayerTimeFilter,
  LayerUpdate,
} from './layer.js';
import type { LegendDefinition, LegendValue } from './legend.js';
import type { MapLocation } from './map.js';
import type { FeatureReference, LayerIdentifyHit, LayerIdentifyQuery } from './interaction.js';

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
  commitUpdate?(patch: EngineLayerPatch): undefined;
  /** Legacy update hook. Core still applies the common visibility and order setters. */
  update?(patch: EngineLayerPatch): void | Promise<void>;
  dispose(): void | Promise<void>;
  getMetadata?(): Readonly<Record<string, unknown>>;
  readonly capabilities?: Readonly<Partial<LayerCapabilities>>;
}

export type EngineLayerPatch = Omit<LayerUpdate, 'expectedVersion'>;

export interface LayerCapabilities {
  readonly feature: Pick<MapLayerHandle, 'identify' | 'canSelectFeature'>;
  readonly attributes: Pick<MapLayerHandle, 'getFields' | 'getFieldValues'>;
  readonly location: Required<Pick<MapLayerHandle, 'getDataLocation'>>;
  readonly legend: Pick<
    MapLayerHandle,
    'resolveLegend' | 'supportsLegendFilter' | 'getLegendFilter' | 'setLegendFilter'
  >;
  readonly temporal: Pick<MapLayerHandle, 'getTimeDimensions' | 'getTimeFilter' | 'setTimeFilter'>;
  readonly styling: Required<Pick<MapLayerHandle, 'getStyle'>>;
}
