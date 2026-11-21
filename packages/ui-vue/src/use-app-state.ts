import { computed, onBeforeUnmount, shallowRef } from 'vue'
import { useGISApp } from './use-gis-app.js'
import type { AppStateSnapshot, DeepReadonly } from '@joinmap/gis-core'

/** Read-only Vue projection of the Runtime snapshot. */
export function useAppState(): Readonly<import('vue').ComputedRef<DeepReadonly<AppStateSnapshot>>>
export function useAppState<T>(select: (snapshot: DeepReadonly<AppStateSnapshot>) => T): Readonly<import('vue').ComputedRef<T>>
export function useAppState(select: (snapshot: DeepReadonly<AppStateSnapshot>) => unknown = value => value) {
  const state = useGISApp().context.state
  const snapshot = shallowRef(select(state.snapshot()))
  const unsubscribe = state.subscribe(value => {
    const next = select(value)
    if (!Object.is(snapshot.value, next)) snapshot.value = next
  })
  onBeforeUnmount(unsubscribe)
  return computed(() => snapshot.value)
}
