import { computed, shallowRef } from 'vue';
import type { PanelConfig, PanelPosition } from '@joinmap/gis-core';
import type { PanelService, PanelState, VuePanelDefinition } from '../types.js';

const compareOrder = (left: PanelState, right: PanelState) =>
  left.order - right.order || left.id.localeCompare(right.id);

export class PanelRegistry implements PanelService {
  private readonly definitions = new Map<string, VuePanelDefinition>();
  private readonly configured = new Map<string, PanelConfig>();
  private readonly current = shallowRef<readonly PanelState[]>(Object.freeze([]));
  readonly states = computed(() => this.current.value);

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

    const { id, allowedPositions, header } = definition;
    const stableDefinition = Object.freeze({
      ...definition,
      ...(allowedPositions && { allowedPositions: Object.freeze([...allowedPositions]) }),
      ...(header && { header: Object.freeze({ ...header }) }),
    });
    const config = this.configured.get(id);
    const firstAllowed = allowedPositions?.[0];
    const preferred = definition.position ?? firstAllowed ?? 'left';
    let position = config?.position ?? preferred;
    if (allowedPositions && firstAllowed && !allowedPositions.includes(position)) {
      position = allowedPositions.includes(preferred) ? preferred : firstAllowed;
      console.warn(
        `[gis-ui-vue] ${id} does not support position "${config?.position ?? preferred}"; using "${position}".`
      );
    }
    const state: PanelState = Object.freeze({
      id,
      visible: config?.visible ?? definition.defaultVisible ?? false,
      collapsed: config?.collapsed ?? definition.defaultCollapsed ?? false,
      position,
      order: config?.order ?? definition.order ?? this.current.value.length,
      width: config?.width ?? definition.width,
      height: config?.height ?? definition.height,
    });
    this.definitions.set(id, stableDefinition);
    this.current.value = Object.freeze([...this.current.value, state]);

    return () => {
      if (this.definitions.get(id) !== stableDefinition) {
        return;
      }
      this.definitions.delete(id);
      this.current.value = Object.freeze(this.current.value.filter((entry) => entry.id !== id));
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
    this.current.value = Object.freeze([]);
  }

  get(id: string): VuePanelDefinition | undefined {
    return this.getState(id) && this.definitions.get(id);
  }

  list(position?: PanelPosition): VuePanelDefinition[] {
    return this.states.value
      .filter((state) => position === undefined || state.position === position)
      .sort(compareOrder)
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
    if (!ids.length) {
      return;
    }
    const remaining = this.current.value
      .filter(
        (state) => (position === undefined || state.position === position) && !seen.has(state.id)
      )
      .sort(compareOrder);
    const updates = new Map(
      [...ids, ...remaining.map((state) => state.id)].map((id, index) => [id, index])
    );
    this.current.value = Object.freeze(
      this.current.value.map((state) => {
        const order = updates.get(state.id);
        return order === undefined || order === state.order
          ? state
          : Object.freeze({ ...state, order });
      })
    );
  }

  getState(id: string): PanelState | undefined {
    return this.states.value.find((state) => state.id === id);
  }

  private updateState(id: string, patch: Partial<PanelState>): void {
    this.requireState(id);
    this.current.value = Object.freeze(
      this.current.value.map((state) =>
        state.id === id ? Object.freeze({ ...state, ...patch }) : state
      )
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
