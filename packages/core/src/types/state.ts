import type { LayerInstance, LayerStyle, LegendDefinition } from '../types.js'
import type { AppStatus, DeepReadonly, JsonValue, Unsubscribe } from './common.js'
import type { DataSet } from './data.js'
import type { FeatureReference } from './interaction.js'

export interface MapStateSnapshot {
  readonly ready: boolean
  readonly projection: string | null
  readonly center: readonly [number, number] | null
  readonly zoom: number | null
  readonly resolution: number | null
  /** Ground resolution at the view center, supplied by the map adapter. */
  readonly metersPerPixel: number | null
  readonly rotation: number | null
}

export interface LayerStateSnapshot {
  readonly style: LayerStyle | null
  readonly version: number
  readonly id: string
  readonly type: string
  readonly title: string | null
  readonly visible: boolean
  readonly status: LayerInstance['status']
  readonly metadata: Readonly<Record<string, JsonValue>>
  readonly legend: LegendDefinition | null
}

export interface DataStateSnapshot {
  readonly id: string
  readonly status: DataSet['status']
  readonly error: string | null
}

export interface AppStateSnapshot {
  readonly revision: number
  readonly status: AppStatus
  readonly map: MapStateSnapshot
  readonly layers: readonly LayerStateSnapshot[]
  readonly data: readonly DataStateSnapshot[]
  readonly interactions: { readonly activeToolId: string | null; readonly selection: FeatureReference | null }
  readonly extensions: Readonly<Record<string, JsonValue>>
}

export interface AppState {
  snapshot(): DeepReadonly<AppStateSnapshot>
  subscribe(listener: (snapshot: DeepReadonly<AppStateSnapshot>) => void): Unsubscribe
}

export interface StateContributor {
  snapshot(): JsonValue
  subscribe(listener: () => void): Unsubscribe
}
