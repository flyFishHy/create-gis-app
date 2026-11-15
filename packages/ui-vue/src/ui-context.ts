import type { InjectionKey } from 'vue'
import type { GISUIContext } from './types.js'

export const GISUIContextKey: InjectionKey<GISUIContext> = Symbol('joinmap.gis-ui-context')
