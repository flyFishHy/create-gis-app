import type { GISRuntimeError } from '../errors.js'
import type { FeatureReference } from './interaction.js'
import type { Unsubscribe } from './common.js'

export interface GISAppEvents {
  'app:ready': { appId: string }
  'app:error': { error: GISRuntimeError }
  'layer:added': { layerId: string }
  'layer:removed': { layerId: string }
  'layer:updated': { layerId: string }
  'layer:visibility-changed': { layerId: string; visible: boolean }
  'tool:activated': { toolId: string }
  'tool:deactivated': { toolId: string }
  'feature:selected': { feature?: FeatureReference }
}

export interface EventService {
  on<K extends keyof GISAppEvents>(
    event: K,
    listener: (payload: GISAppEvents[K]) => void
  ): Unsubscribe
  once<K extends keyof GISAppEvents>(
    event: K,
    listener: (payload: GISAppEvents[K]) => void
  ): Unsubscribe
  emit<K extends keyof GISAppEvents>(event: K, payload: GISAppEvents[K]): void
}
