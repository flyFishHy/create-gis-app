import type { UIConfig } from '@joinmap/gis-core';
import type { ShallowRef } from 'vue';
import type { GISUIContext } from '../../types.js';

export function installPropertiesSelection(
  { app, panels }: GISUIContext,
  config: Readonly<UIConfig>,
  layout: Readonly<ShallowRef<string>>
): () => void {
  const autoOpen = config.panels?.find((panel) => panel.id === 'properties')?.visible !== false;
  const sync = () => {
    if (app.interactions.getSelection()) {
      if (autoOpen) {
        panels.show('properties');
      }
    } else if (layout.value !== 'docked-dashboard') {
      panels.hide('properties');
    }
  };
  // Selection events drive visibility. Switching layout preserves manual choices.
  if (app.interactions.getSelection()) {
    sync();
  }
  return app.interactions.onSelect(sync);
}
