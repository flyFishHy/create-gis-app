import { shallowRef } from 'vue';
import type { PanelConfig, PanelPosition } from '@joinmap/gis-core';
import type { PanelService, PanelState, VuePanelDefinition } from '../types.js';

export class PanelRegistry implements PanelService {
  private readonly definitions = new Map<string, VuePanelDefinition>();
  private readonly configured = new Map<string, PanelConfig>();
  readonly states = shallowRef<readonly PanelState[]>([]);

  constructor(configuredPanels: readonly PanelConfig[] = []) {
    for (const config of configuredPanels) {
      this.configured.set(config.id, config);
    }
  }

  register(definition: VuePanelDefinition): () => void {
    if (!definition.id?.trim()) {
      throw new Error('Panel id must be a non-empty string.');
    }
    if (this.definitions.has(definition.id)) {
      throw new Error(`Panel "${definition.id}" is already registered.`);
    }

    const stableDefinition = Object.freeze({ ...definition });
    this.definitions.set(definition.id, stableDefinition);
    const config = this.configured.get(definition.id);
    const state: PanelState = Object.freeze({
      id: definition.id,
      visible: config?.visible ?? definition.defaultVisible ?? false,
      collapsed: config?.collapsed ?? definition.defaultCollapsed ?? false,
      position: config?.position ?? definition.position ?? 'left',
      order: config?.order ?? definition.order ?? this.states.value.length,
      width: config?.width ?? definition.width,
      height: config?.height ?? definition.height,
    });
    this.states.value = [...this.states.value, state];

    let registered = true;
    return () => {
      if (!registered) {
        return;
      }
      registered = false;
      this.definitions.delete(definition.id);
      this.states.value = this.states.value.filter((entry) => entry.id !== definition.id);
    };
  }

  warnForUnknownConfiguredPanels(): void {
    for (const id of this.configured.keys()) {
      if (!this.definitions.has(id)) {
        console.warn(`[gis-ui-vue] Panel configuration references unregistered panel "${id}".`);
      }
    }
  }

  clear(): void {
    this.definitions.clear();
    this.configured.clear();
    this.states.value = [];
  }

  get(id: string): VuePanelDefinition | undefined {
    return this.definitions.get(id);
  }

  list(position?: PanelPosition): VuePanelDefinition[] {
    return this.states.value
      .filter((state) => position === undefined || state.position === position)
      .slice()
      .sort(
        (leftPanel, rightPanel) =>
          leftPanel.order - rightPanel.order || leftPanel.id.localeCompare(rightPanel.id)
      )
      .map((state) => this.definitions.get(state.id))
      .filter((definition): definition is VuePanelDefinition => definition !== undefined);
  }

  show(id: string): void {
    this.updateState(id, { visible: true });
  }
  hide(id: string): void {
    this.updateState(id, { visible: false });
  }
  toggle(id: string): void {
    const state = this.requireState(id);
    this.updateState(id, { visible: !state.visible });
  }
  collapse(id: string): void {
    this.updateState(id, { collapsed: true });
  }
  expand(id: string): void {
    this.updateState(id, { collapsed: false });
  }

  setOrder(ids: string[], position?: PanelPosition): void {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) {
        throw new Error(`Panel "${id}" occurs more than once in the requested order.`);
      }
      const state = this.requireState(id);
      if (position !== undefined && state.position !== position) {
        throw new Error(`Panel "${id}" is not in the "${position}" region.`);
      }
      seen.add(id);
    }
    const updates = new Map(ids.map((id, index) => [id, index]));
    this.states.value = this.states.value.map((state) => {
      const order = updates.get(state.id);
      return order === undefined ? state : Object.freeze({ ...state, order });
    });
  }

  getState(id: string): PanelState | undefined {
    return this.states.value.find((state) => state.id === id);
  }

  private updateState(id: string, patch: Partial<PanelState>): void {
    this.requireState(id);
    this.states.value = this.states.value.map((state) =>
      state.id === id ? Object.freeze({ ...state, ...patch }) : state
    );
  }

  private requireState(id: string): PanelState {
    const state = this.getState(id);
    if (!state) {
      throw new Error(`Panel "${id}" is not registered.`);
    }
    return state;
  }
}
