import { inject } from 'vue';
import { GISUIContextKey } from './ui-context.js';

export function useGISUI() {
  const context = inject(GISUIContextKey);
  if (!context) {
    throw new Error('useGISUI() must be called inside GISUIRoot.');
  }
  return context;
}
