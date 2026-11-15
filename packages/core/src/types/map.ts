import type { Unsubscribe } from './common.js'
import type { MapLayerHandle } from '../types.js'
import type { MapStateSnapshot } from './state.js'

export interface MapConfig {
  readonly projection?: string
  readonly center?: readonly [number, number]
  readonly zoom?: number
  readonly minZoom?: number
  readonly maxZoom?: number
}

export interface MapViewService {
  getCenter(): readonly [number, number] | undefined
  setCenter(center: readonly [number, number]): void
  getZoom(): number | undefined
  setZoom(zoom: number): void
  fit(extent: readonly [number, number, number, number]): void
}

export interface MapAdapter {
  /** Pointer longitude/latitude (EPSG:4326); undefined when leaving the viewport. */
  onPointerMove?(listener: (coordinate: readonly [number, number] | undefined) => void): Unsubscribe
  locate?(location: MapLocation): void
  readonly name: string
  create(config: MapConfig): void | Promise<void>
  destroy(): void | Promise<void>
  getView(): MapViewService
  getSize(): [number, number] | undefined
  updateSize(): void
  setTarget(target: HTMLElement | string | undefined): void
  addLayer(layer: MapLayerHandle, index?: number): void
  removeLayer(layer: MapLayerHandle): void
  setLayerOrder(layers: readonly MapLayerHandle[]): void
  getViewState?(): Omit<MapStateSnapshot, 'ready'>
  onViewChange?(listener: () => void): Unsubscribe
}

export interface MapService {
  onPointerMove(listener: (coordinate: readonly [number, number] | undefined) => void): Unsubscribe
  locate(location: MapLocation): void
  readonly isReady: boolean
  getView(): MapViewService
  getSize(): [number, number] | undefined
  updateSize(): void
  setTarget(target: HTMLElement | string | undefined): void
  getAdapter(): MapAdapter
}

/** Omitted projection means the current map projection. */
export interface MapLocation {
  readonly projection?: string
  readonly coordinate?: readonly [number, number]
  readonly extent?: readonly [number, number, number, number]
}
