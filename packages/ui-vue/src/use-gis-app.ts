import { inject } from 'vue'
import { GISAppKey } from './injection.js'

export function useGISApp() {
  const app = inject(GISAppKey)
  if (!app) throw new Error('useGISApp() must be called inside GISUIRoot.')
  return app
}
