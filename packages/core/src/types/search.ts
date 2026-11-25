import type { MapLocation } from './map.js';
import type { ResourceScope } from './plugin.js';
import type { Unsubscribe } from './common.js';
import type { FeatureReference } from './interaction.js';

export interface SearchResult<T = unknown> extends MapLocation {
  readonly layerId?: string;
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly feature?: FeatureReference;
  readonly data?: T;
}

export interface SearchQuery {
  readonly layerId?: string;
  readonly keyword: string;
  readonly filters?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface SearchProvider {
  readonly id: string;
  /** Omitted means a general provider that must honor query.layerId when present. */
  readonly layerIds?: readonly string[];
  search(query: SearchQuery): Promise<readonly SearchResult[]>;
}

export interface SearchService {
  registerProvider(provider: SearchProvider, resources?: ResourceScope): Unsubscribe;
  listProviders(): readonly SearchProvider[];
  subscribe(listener: () => void): Unsubscribe;
  search(query: SearchQuery): Promise<SearchResult[]>;
}
