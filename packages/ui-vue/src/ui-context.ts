import type { InjectionKey, ComputedRef } from 'vue'
import type { GISUIContext } from './types.js'

export const GISUIContextKey: InjectionKey<GISUIContext> = Symbol('joinmap.gis-ui-context')
export const DockedPanelMotionKey: InjectionKey<ComputedRef<boolean>> = Symbol('joinmap.docked-panel-motion')
