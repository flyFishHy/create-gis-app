import { layerCapability } from './layer-capabilities.js';
import { applyEngineEffects, type LayerEngineEffect } from './layer-engine-effects.js';
import { normalizeLayerLegend, normalizeLayerStyle } from '../config/app-config.js';
import { deepFreeze, validateJsonValue } from '../config/json.js';
import { GISRuntimeError } from '../errors.js';
import type {
  LayerConfig,
  LayerInstance,
  LayerStyle,
  LayerTimeDimension,
  LayerTimeFilter,
  LayerUpdate,
  LegendDefinition,
  MapLayerHandle,
} from '../types.js';

type LayerInstanceChange =
  { type: 'update'; id: string } | { type: 'visibility'; id: string; visible: boolean };

export interface LayerInstanceOptions {
  config: LayerConfig;
  handle?: MapLayerHandle;
  onDispose: () => Promise<void>;
  changed: (event?: LayerInstanceChange) => void;
  transact: (operation: () => void) => void;
  assertMutable: () => void;
  parentId: () => string | null;
  children?: () => LayerOperations[];
  leaves?: () => LayerOperations[];
}

export class LayerOperations {
  private currentStatus: LayerInstance['status'] = 'ready';
  private currentVisible: boolean;
  private inheritedVisible = true;
  private currentTitle?: string;
  private disposal?: Promise<void>;
  private updates: Promise<void> = Promise.resolve();
  private legacyUpdateInProgress = false;
  private currentLegend?: LegendDefinition;
  private currentStyle?: LayerStyle;
  private currentVersion = 0;
  private currentZIndex?: number;

  readonly id: string;
  readonly type: string;

  constructor(private readonly options: LayerInstanceOptions) {
    const { id, type, title, visible = true, legend, style, zIndex } = options.config;
    this.id = id;
    this.type = type;
    this.currentTitle = title;
    this.currentVisible = visible;
    this.currentZIndex = zIndex;
    this.currentLegend = legend === undefined ? undefined : normalizeLayerLegend(legend, id);
    this.currentStyle = style === undefined ? undefined : normalizeLayerStyle(style);
  }

  private get handle() {
    return this.options.handle;
  }

  private get children() {
    return this.options.children;
  }

  setZIndex(value: number): void {
    const plan = this.prepareOrder(value);
    applyEngineEffects(plan.effects, 'layer-order');
    plan.commit();
  }

  private prepareOrder(value: number) {
    const leaves = this.options.leaves?.().sort((left, right) => left.zIndex - right.zIndex);
    const entries = (leaves ?? [this]).map((layer, index, items) => {
      const next = value + index / items.length;
      const previous = layer.zIndex;
      const handle = layer.handle;
      layer.assertIdle();
      return {
        apply: () => handle?.setZIndex(next),
        rollback: () => handle?.setZIndex(previous),
        commit: () => layer.recordZIndex(next),
      };
    });
    return {
      effects: entries,
      commit: () => {
        entries.forEach((entry) => entry.commit());
        this.recordZIndex(value);
      },
    };
  }

  recordZIndex(value: number): void {
    this.currentZIndex = value;
  }

  get zIndex(): number {
    const leaves = this.options.leaves?.();
    if (leaves?.length) {
      return Math.max(...leaves.map((leaf) => leaf.zIndex));
    }
    if (this.currentZIndex !== undefined) {
      return this.currentZIndex;
    }
    const initialEngineValue = this.handle?.getMetadata?.().zIndex;
    return typeof initialEngineValue === 'number' && Number.isFinite(initialEngineValue)
      ? initialEngineValue
      : 0;
  }

  get parentId(): string | null {
    return this.options.parentId();
  }

  get childIds(): readonly string[] {
    return Object.freeze(this.children?.().map(({ id }) => id) ?? []);
  }

  get title(): string | undefined {
    return this.currentTitle;
  }
  get style(): LayerStyle | undefined {
    return layerCapability(this.handle, 'styling')?.getStyle?.() ?? this.currentStyle;
  }
  getFields() {
    return layerCapability(this.handle, 'attributes')?.getFields?.() ?? [];
  }
  getFieldValues(field: string) {
    if (this.currentStatus === 'disposed') {
      return [];
    }
    return Object.freeze([
      ...new Set(
        (layerCapability(this.handle, 'attributes')?.getFieldValues?.(field) ?? []).filter(
          (value) =>
            typeof value === 'string' ||
            typeof value === 'boolean' ||
            (typeof value === 'number' && Number.isFinite(value))
        )
      ),
    ]);
  }
  get version(): number {
    return this.currentVersion;
  }
  get status(): LayerInstance['status'] {
    return this.currentStatus;
  }
  get visible(): boolean {
    return this.currentVisible && this.inheritedVisible;
  }

  get ownVisible(): boolean {
    return this.currentVisible;
  }
  get legend(): LegendDefinition | undefined {
    const legend = this.currentLegend;
    const capability = layerCapability(this.handle, 'legend');
    return legend && capability?.resolveLegend
      ? normalizeLayerLegend(capability.resolveLegend(legend), this.id)
      : legend;
  }
  settleUpdates(): Promise<void> {
    return this.updates;
  }

  setVisibility(visible: boolean): void {
    this.assertActive();
    this.assertIdle();
    this.options.transact(() => {
      this.applyVisibility(visible && this.inheritedVisible);
      this.currentVisible = visible;
      this.currentVersion++;
      this.options.changed({ type: 'visibility', id: this.id, visible: this.visible });
    });
  }

  /** Project the parent gate before publishing a newly attached branch. */
  inheritVisibility(visible: boolean): void {
    const effective = visible && this.currentVisible;
    if (effective !== this.visible || this.children) {
      this.applyVisibility(effective);
    }
    this.inheritedVisible = visible;
  }

  private applyVisibility(visible: boolean): void {
    const plan = this.prepareVisibility(visible);
    applyEngineEffects(plan.effects, 'layer-visibility');
    plan.commit();
  }

  private prepareVisibility(visible: boolean) {
    const effects: LayerEngineEffect[] = [];
    const projection: { layer: LayerOperations; parentVisible: boolean; before: boolean }[] = [];
    const write = (layer: LayerOperations, next: boolean, before: boolean) => {
      const handle = layer.handle;
      if (handle) {
        layer.assertIdle();
        effects.push({
          apply: () => handle.setVisible(next),
          rollback: () => handle.setVisible(before),
        });
      }
    };
    const collect = (group: LayerOperations, parentVisible: boolean) => {
      for (const layer of group.children?.() ?? []) {
        if (layer.status !== 'ready') {
          continue;
        }
        const next = layer.currentVisible && parentVisible;
        collect(layer, next);
        const before = layer.visible;
        if (next !== before) {
          write(layer, next, before);
        }
        projection.push({ layer, parentVisible, before });
      }
    };
    write(this, visible, this.visible);
    collect(this, visible);
    return {
      effects,
      commit: () => {
        for (const { layer, parentVisible } of projection) {
          layer.inheritedVisible = parentVisible;
        }
        for (const { layer, before } of projection) {
          if (before !== layer.visible) {
            layer.currentVersion++;
            layer.options.changed({ type: 'visibility', id: layer.id, visible: layer.visible });
          }
        }
      },
    };
  }

  getTimeDimensions(): readonly LayerTimeDimension[] {
    if (this.currentStatus === 'disposed') {
      return [];
    }
    return layerCapability(this.handle, 'temporal')?.getTimeDimensions?.() ?? [];
  }

  getTimeFilter(): LayerTimeFilter | undefined {
    if (this.currentStatus === 'disposed') {
      return undefined;
    }
    return layerCapability(this.handle, 'temporal')?.getTimeFilter?.();
  }

  supportsLegendFilter(): boolean {
    return (
      this.currentStatus !== 'disposed' &&
      layerCapability(this.handle, 'legend')?.supportsLegendFilter?.() === true
    );
  }

  getLegendFilter(): string | undefined {
    return this.currentStatus === 'disposed'
      ? undefined
      : layerCapability(this.handle, 'legend')?.getLegendFilter?.();
  }

  setLegendFilter(ruleId: string | undefined): void {
    this.assertActive();
    this.assertIdle();
    const capability = layerCapability(this.handle, 'legend');
    const setFilter = capability?.setLegendFilter;
    if (!setFilter || !this.supportsLegendFilter()) {
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message: `Layer "${this.id}" does not support legend filtering.`,
        stage: 'layer-operation',
      });
    }
    this.options.transact(() => {
      setFilter.call(capability, ruleId);
      this.currentVersion++;
      this.options.changed();
    });
  }

  setTimeFilter(filter: LayerTimeFilter | undefined): void {
    this.assertActive();
    this.assertIdle();
    const capability = layerCapability(this.handle, 'temporal');
    const setFilter = capability?.setTimeFilter;
    if (!setFilter) {
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message: `Layer "${this.id}" does not support time filtering.`,
        stage: 'layer-operation',
      });
    }
    if (
      filter &&
      (!filter.field.trim() ||
        !Number.isFinite(filter.start) ||
        !Number.isFinite(filter.end) ||
        filter.start > filter.end)
    ) {
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message: `Layer "${this.id}" received an invalid time filter.`,
        stage: 'layer-operation',
      });
    }
    this.options.transact(() => {
      setFilter.call(capability, filter);
      this.currentVersion++;
      this.options.changed();
    });
  }

  async update(patch: LayerUpdate): Promise<void> {
    this.assertActive();
    validateJsonValue(patch, 'layer.update', new WeakSet(), true);
    const captured = deepFreeze(JSON.parse(JSON.stringify(patch)) as LayerUpdate);
    const operation = this.updates.then(() => this.applyUpdate(captured));
    this.updates = operation.catch(() => undefined);
    return operation;
  }

  private validateUpdate(patch: LayerUpdate): void {
    if (patch.expectedVersion !== undefined && patch.expectedVersion !== this.currentVersion) {
      throw new GISRuntimeError({
        code: 'APP_INVALID_STATE',
        message: 'Layer changed since editing began. Reload before applying.',
        stage: 'layer-update',
      });
    }
    if (patch.options?.style !== undefined) {
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message: 'Move options.style to layer.style.',
        stage: 'layer-update',
      });
    }
    if (
      (patch.options !== undefined || patch.style !== undefined) &&
      !this.handle?.commitUpdate &&
      !this.handle?.update
    ) {
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message: `Layer "${this.id}" does not support options updates.`,
        stage: 'layer-update',
      });
    }
  }

  private commitCommonUpdate(patch: LayerUpdate): void {
    const order = patch.zIndex === undefined ? undefined : this.prepareOrder(patch.zIndex);
    const visibility =
      patch.visible === undefined
        ? undefined
        : this.prepareVisibility(patch.visible && this.inheritedVisible);
    applyEngineEffects([...(order?.effects ?? []), ...(visibility?.effects ?? [])], 'layer-update');
    order?.commit();
    visibility?.commit();
  }

  private async applyUpdate(patch: LayerUpdate): Promise<void> {
    this.assertActive();
    this.validateUpdate(patch);
    let nextLegend = this.currentLegend;
    if (patch.legend !== undefined) {
      nextLegend = patch.legend === null ? undefined : normalizeLayerLegend(patch.legend, this.id);
    }
    const nextStyle =
      patch.style === undefined ? this.currentStyle : normalizeLayerStyle(patch.style);
    const { expectedVersion: _expectedVersion, ...rest } = patch;
    const enginePatch = {
      ...rest,
      ...(patch.visible !== undefined ? { visible: patch.visible && this.inheritedVisible } : {}),
      ...(patch.legend !== undefined ? { legend: nextLegend ?? null } : {}),
      ...(patch.style !== undefined ? { style: nextStyle } : {}),
    };
    const handle = this.handle;
    const commitUpdate = handle?.commitUpdate;
    if (Object.keys(enginePatch).length) {
      if (commitUpdate) {
        commitUpdate.call(handle, enginePatch);
      } else if (handle?.update) {
        this.legacyUpdateInProgress = true;
        try {
          await handle.update(enginePatch);
        } finally {
          this.legacyUpdateInProgress = false;
        }
      }
    }
    this.assertActive();
    this.options.transact(() => {
      if (!commitUpdate) {
        this.commitCommonUpdate(patch);
      }
      if (patch.visible !== undefined) {
        this.currentVisible = patch.visible;
      }
      if (patch.zIndex !== undefined) {
        this.currentZIndex = patch.zIndex;
      }
      if (patch.title !== undefined) {
        this.currentTitle = patch.title;
      }
      this.currentLegend = nextLegend;
      this.currentStyle = nextStyle;
      this.currentVersion++;
      this.options.changed(
        patch.visible === undefined
          ? { type: 'update', id: this.id }
          : { type: 'visibility', id: this.id, visible: this.visible }
      );
    });
  }

  dispose(): Promise<void> {
    if (this.disposal) {
      return this.disposal;
    }
    this.currentStatus = 'disposed';
    // Prevent queued commits immediately, but release the handle only after active work settles.
    this.disposal = this.updates.then(() => this.options.onDispose());
    this.options.changed();
    return this.disposal;
  }

  getMetadata(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      ...this.handle?.getMetadata?.(),
      ...(this.children ? { childIds: this.childIds, zIndex: this.zIndex } : {}),
      id: this.id,
      type: this.type,
      title: this.title,
    });
  }

  getInternalHandle(): MapLayerHandle | undefined {
    return this.handle;
  }

  assertIdle(): void {
    if (this.legacyUpdateInProgress) {
      throw new GISRuntimeError({
        code: 'APP_INVALID_STATE',
        message: `Layer "${this.id}" is processing an asynchronous adapter update.`,
        stage: 'layer-operation',
        detail: { layerId: this.id, reason: 'busy' },
      });
    }
  }

  private assertActive(): void {
    this.options.assertMutable();
    if (this.currentStatus === 'disposed') {
      throw new GISRuntimeError({
        code: 'APP_DISPOSED',
        message: `Layer "${this.id}" has been disposed.`,
        stage: 'layer-operation',
      });
    }
  }
}
