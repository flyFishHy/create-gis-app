import type { AppContext } from './app.js';
import type { Unsubscribe } from './common.js';
import type { ResourceScope } from './plugin.js';
import type { MapOverlayAnchor } from './map.js';

export interface FeatureReference {
  /** Selection owner; omitted means a business layer. Other owners manage their own invalidation. */
  readonly source?: string;
  readonly id?: string | number;
  /** Opaque identity within the current layer data. It is separate from the business ID. */
  readonly featureKey?: string;
  readonly layerId: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly geometryType?: string;
}

export interface LayerIdentifyQuery {
  readonly pixel: readonly [number, number];
  readonly coordinate: readonly [number, number];
  readonly projection: string;
  readonly resolution: number;
  readonly signal: AbortSignal;
}

export type LayerIdentifyHit = Omit<FeatureReference, 'layerId' | 'source'> & {
  readonly title?: string;
};
export type FeaturePickCandidate = FeatureReference & { readonly title?: string };

/** Layer IDs are supplied in front-to-back rendering order. */
export interface MapFeaturePick {
  readonly pixel: LayerIdentifyQuery['pixel'];
  readonly location?: Omit<LayerIdentifyQuery, 'pixel' | 'signal'>;
  readonly layerIds: readonly string[];
  readonly candidates: readonly FeaturePickCandidate[];
}

export type FeaturePickState = {
  readonly pixel: MapFeaturePick['pixel'];
  readonly anchor?: MapOverlayAnchor;
} & (
  | { readonly status: 'loading' | 'failed' }
  | {
      readonly status: 'choices';
      readonly candidates: readonly FeaturePickCandidate[];
      readonly incomplete: boolean;
    }
);

export interface SelectOptions {
  readonly feature: FeatureReference;
}

export interface ToolDefinition {
  /** Actions execute once and do not remain the active interaction. */
  readonly mode?: 'action';
  canActivate?(context: AppContext): boolean;
  undo?(context: AppContext): void;
  readonly id: string;
  readonly title?: string;
  activate(context: AppContext): void | Promise<void>;
  deactivate?(context: AppContext): void | Promise<void>;
}

export interface InteractionService {
  hasTool(id: string): boolean;
  canActivateTool(id: string): boolean;
  undoActiveTool(): void;
  select(options?: SelectOptions): void;
  clearSelection(): void;
  getSelection(): FeatureReference | undefined;
  onSelect(listener: (feature: FeatureReference | undefined) => void): Unsubscribe;
  pickFeatures(pick: MapFeaturePick): Promise<void>;
  registerFeaturePicker(listener: (pick: FeaturePickState | undefined) => void): Unsubscribe;
  cancelFeaturePick(options?: { readonly preserveAnchoredChoices?: boolean }): void;
  registerTool(id: string, definition: ToolDefinition, resources: ResourceScope): void;
  activateTool(id: string): Promise<void>;
  deactivateTool(expectedId?: string): Promise<void>;
  getActiveTool(): string | undefined;
}
