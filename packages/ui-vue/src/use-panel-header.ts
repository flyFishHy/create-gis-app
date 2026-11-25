import { inject, onBeforeUnmount, watch, type ComputedRef } from 'vue';
import { PanelHeaderKey } from './ui-context.js';

export function usePanelHeader(badge: ComputedRef<string>, refresh: () => void): void {
  const header = inject(PanelHeaderKey, undefined);
  if (!header) {
    return;
  }
  header.refresh.value = refresh;
  watch(
    badge,
    (value) => {
      header.badge.value = value;
    },
    { immediate: true, flush: 'sync' }
  );
  onBeforeUnmount(() => {
    if (header.refresh.value === refresh) {
      header.refresh.value = undefined;
      header.badge.value = '';
    }
  });
}
