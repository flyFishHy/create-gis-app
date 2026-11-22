import type { AppStateSnapshot, LayerInstance } from '../types.js'
import { stateValue } from './json-value.js'

type DomainSnapshot = Pick<AppStateSnapshot, 'map' | 'layers' | 'data'>

/** Project owning services into JSON metadata; no writable domain copies. */
export function createSnapshotReader(
  map: () => DomainSnapshot['map'],
  layers: () => readonly LayerInstance[],
  data: () => DomainSnapshot['data']
): () => DomainSnapshot {
  return () => ({
    map: map(),
    layers: layers().map((layer) => ({
      id: layer.id,
      version: layer.version,
      type: layer.type,
      title: layer.title ?? null,
      visible: layer.visible,
      status: layer.status,
      style: layer.style ?? null,
      legend: layer.legend ?? null,
      metadata: stateValue(layer.getMetadata()) as AppStateSnapshot['layers'][number]['metadata'],
    })),
    data: data(),
  })
}
