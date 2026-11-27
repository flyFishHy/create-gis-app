import { watch, type ShallowRef } from 'vue';
import type { GISApp, JsonValue, ResourceScope } from '@joinmap/gis-core';
import type { TimeSelection } from '../components/time-picker/types.js';
import type { PanelRegistry } from '../panels/panel-registry.js';
import type { GISUIContext } from '../types.js';

export function registerUIState(
  runtime: GISApp,
  { panels, theme, locale }: Pick<GISUIContext, 'theme' | 'locale'> & { panels: PanelRegistry },
  layout: Readonly<ShallowRef<string>>,
  getTimeSelection: () => TimeSelection | null,
  resources: ResourceScope
): void {
  runtime.registerStateSlice(
    'vue-ui',
    {
      snapshot: () =>
        JSON.parse(
          JSON.stringify({
            panels: panels.states.value,
            theme: theme.get(),
            locale: locale.get(),
            layout: layout.value,
            timeSelection: getTimeSelection(),
          })
        ) as JsonValue,
      subscribe: (listener) =>
        watch(
          [
            () => panels.states.value,
            () => theme.get(),
            () => locale.get(),
            layout,
            getTimeSelection,
          ],
          listener,
          { flush: 'sync' }
        ),
    },
    resources
  );
}
