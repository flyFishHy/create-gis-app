import type { InjectionKey, ComputedRef, ShallowRef } from 'vue'
import type { GISUIContext } from './types.js'

export const GISUIContextKey: InjectionKey<GISUIContext> = Symbol('joinmap.gis-ui-context')
export const DockedPanelMotionKey: InjectionKey<ComputedRef<boolean>> = Symbol(
  'joinmap.docked-panel-motion'
)
/** Scoped to a PanelHost; content contributes presentation-only header controls. */
export const PanelHeaderKey: InjectionKey<{
  badge: ShallowRef<string>
  refresh: ShallowRef<(() => void) | undefined>
}> = Symbol('joinmap.panel-header')
