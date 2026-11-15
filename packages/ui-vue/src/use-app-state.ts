import { computed, onBeforeUnmount, shallowRef } from 'vue'
import { useGISApp } from './use-gis-app.js'

/** Read-only Vue projection of the Runtime snapshot. */
export function useAppState() {
  const state = useGISApp().context.state
  const snapshot = shallowRef(state.snapshot())
  const unsubscribe = state.subscribe(value => { snapshot.value = value })
  onBeforeUnmount(unsubscribe)
  return computed(() => snapshot.value)
}
