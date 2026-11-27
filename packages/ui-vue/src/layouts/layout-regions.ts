import type { PanelPosition } from '@joinmap/gis-core';
import type { PanelService, PanelState, VuePanelDefinition } from '../types.js';

export const layoutRole = Symbol('joinmap.layout-role');
type HostRole = 'toolbar' | 'status' | 'drawer';
type LayoutSlot = PanelPosition | HostRole;
export type LayoutPanelDefinition = VuePanelDefinition & { readonly [layoutRole]?: HostRole };

export function withLayoutRole(
  definition: VuePanelDefinition,
  role: HostRole
): LayoutPanelDefinition {
  return { ...definition, [layoutRole]: role };
}

export function panelSlot(
  definition: LayoutPanelDefinition,
  position: PanelPosition,
  layout?: string
): LayoutSlot {
  const role = definition[layoutRole];
  if (role === 'drawer') {
    return layout === 'overlay-dashboard' && position === 'right' ? role : position;
  }
  return role ?? position;
}

export function routePanels(panels: PanelService, layout?: string) {
  const slots: Record<LayoutSlot, PanelState[]> = {
    top: [],
    left: [],
    right: [],
    bottom: [],
    floating: [],
    toolbar: [],
    status: [],
    drawer: [],
  };
  for (const definition of panels.list()) {
    const state = panels.getState(definition.id);
    if (state) {
      slots[panelSlot(definition, state.position, layout)].push(state);
    }
  }
  return slots;
}
