import type { AppContext } from '../types.js'
import type { AppStateImpl } from '../state/app-state.js'
/** Deferred context is bound once after service construction, never to GISApp. */
export interface ServiceDependencies {
  readonly state: Pick<AppStateImpl, 'status' | 'refresh' | 'batch'>
  readonly context: () => AppContext
}

export interface InteractionDependencies extends ServiceDependencies {
  readonly state: ServiceDependencies['state'] &
    Pick<AppStateImpl, 'interactions' | 'setInteractions'>
}
