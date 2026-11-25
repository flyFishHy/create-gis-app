import { normalizeLayerLegend, normalizeLayerStyle } from '../config/app-config.js';
import { GISRuntimeError } from '../errors.js';
import type {
  LayerInstance,
  LayerLegend,
  LayerStyle,
  LayerTimeDimension,
  LayerTimeFilter,
  LayerUpdate,
  LegendDefinition,
  MapLayerHandle,
} from '../types.js';

type LayerInstanceChange =
  { type: 'update'; id: string } | { type: 'visibility'; id: string; visible: boolean };

export class LayerInstanceImpl implements LayerInstance {
  private currentStatus: LayerInstance['status'] = 'ready';
  private currentVisible: boolean;
  private inheritedVisible = true;
  private currentTitle?: string;
  private disposal?: Promise<void>;
  private updates: Promise<void> = Promise.resolve();
  private currentLegend?: LegendDefinition;
  private currentStyle?: LayerStyle;
  private currentVersion = 0;

  constructor(
    readonly id: string,
    readonly type: string,
    title: string | undefined,
    visible: boolean,
    private readonly handle: MapLayerHandle,
    private readonly onDispose: () => Promise<void>,
    private readonly changed: (event?: LayerInstanceChange) => void,
    private readonly transact: (operation: () => void) => void,
    private readonly assertMutable: () => void,
    legend?: LayerLegend,
    style?: LayerStyle,
    private readonly children?: () => LayerInstanceImpl[]
  ) {
    this.currentTitle = title;
    this.currentVisible = visible;
    this.currentLegend = legend === undefined ? undefined : normalizeLayerLegend(legend, id);
    this.currentStyle = style === undefined ? undefined : normalizeLayerStyle(style);
  }

  get title(): string | undefined {
    return this.currentTitle;
  }
  get style(): LayerStyle | undefined {
    return this.handle.getStyle?.() ?? this.currentStyle;
  }
  getFields() {
    return this.handle.getFields?.() ?? [];
  }
  getFieldValues(field: string) {
    if (this.currentStatus === 'disposed') {
      return [];
    }
    return Object.freeze([
      ...new Set(
        (this.handle.getFieldValues?.(field) ?? []).filter(
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
    return legend && this.handle.resolveLegend
      ? normalizeLayerLegend(this.handle.resolveLegend(legend), this.id)
      : legend;
  }
  settleUpdates(): Promise<void> {
    return this.updates;
  }

  setVisibility(visible: boolean): void {
    this.assertActive();
    this.transact(() => {
      this.applyVisibility(visible && this.inheritedVisible);
      this.currentVisible = visible;
      this.currentVersion++;
      this.changed({ type: 'visibility', id: this.id, visible: this.visible });
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
    if (!this.children) {
      this.handle.setVisible(visible);
      return;
    }
    const projection: { layer: LayerInstanceImpl; parentVisible: boolean; before: boolean }[] = [];
    const collect = (group: LayerInstanceImpl, parentVisible: boolean) => {
      for (const layer of group.children?.() ?? []) {
        collect(layer, layer.currentVisible && parentVisible);
        projection.push({ layer, parentVisible, before: layer.visible });
      }
    };
    collect(this, visible);
    const attempted: typeof projection = [];
    try {
      for (const entry of projection) {
        const { layer, parentVisible, before } = entry;
        const effective = layer.currentVisible && parentVisible;
        if (!layer.children && effective !== before) {
          attempted.push(entry);
          layer.handle.setVisible(effective);
        }
      }
    } catch (cause) {
      const cleanupErrors: unknown[] = [];
      for (const { layer, before } of attempted.reverse()) {
        try {
          layer.handle.setVisible(before);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (cleanupErrors.length) {
        throw new GISRuntimeError({
          code: 'APP_INVALID_STATE',
          message: `Could not restore visibility for group "${this.id}".`,
          stage: 'layer-visibility',
          cause,
          cleanupErrors,
        });
      }
      throw cause;
    }
    for (const { layer, parentVisible } of projection) {
      layer.inheritedVisible = parentVisible;
    }
    for (const { layer, before } of projection) {
      if (before !== layer.visible) {
        layer.currentVersion++;
        layer.changed({ type: 'visibility', id: layer.id, visible: layer.visible });
      }
    }
  }

  getTimeDimensions(): readonly LayerTimeDimension[] {
    if (this.currentStatus === 'disposed') {
      return [];
    }
    return this.handle.getTimeDimensions?.() ?? [];
  }

  getTimeFilter(): LayerTimeFilter | undefined {
    if (this.currentStatus === 'disposed') {
      return undefined;
    }
    return this.handle.getTimeFilter?.();
  }

  supportsLegendFilter(): boolean {
    return this.currentStatus !== 'disposed' && this.handle.supportsLegendFilter?.() === true;
  }

  getLegendFilter(): string | undefined {
    return this.currentStatus === 'disposed' ? undefined : this.handle.getLegendFilter?.();
  }

  setLegendFilter(ruleId: string | undefined): void {
    this.assertActive();
    if (!this.handle.setLegendFilter || !this.supportsLegendFilter()) {
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message: `Layer "${this.id}" does not support legend filtering.`,
        stage: 'layer-operation',
      });
    }
    this.transact(() => {
      this.handle.setLegendFilter!(ruleId);
      this.currentVersion++;
      this.changed();
    });
  }

  setTimeFilter(filter: LayerTimeFilter | undefined): void {
    this.assertActive();
    if (!this.handle.setTimeFilter) {
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
    this.transact(() => {
      this.handle.setTimeFilter!(filter);
      this.currentVersion++;
      this.changed();
    });
  }

  update(patch: LayerUpdate): Promise<void> {
    const operation = this.updates.then(() => this.applyUpdate(patch));
    this.updates = operation.catch(() => undefined);
    return operation;
  }

  private async applyUpdate(patch: LayerUpdate): Promise<void> {
    this.assertActive();
    if (patch.expectedVersion !== undefined && patch.expectedVersion !== this.currentVersion) {
      throw new GISRuntimeError({
        code: 'APP_INVALID_STATE',
        message: 'Layer changed since editing began. Reload before applying.',
        stage: 'layer-update',
      });
    }
    const nextLegend =
      patch.legend === undefined
        ? this.currentLegend
        : patch.legend === null
          ? undefined
          : normalizeLayerLegend(patch.legend, this.id);
    const nextStyle =
      patch.style === undefined ? this.currentStyle : normalizeLayerStyle(patch.style);
    if (patch.options?.style !== undefined) {
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message: 'Move options.style to layer.style.',
        stage: 'layer-update',
      });
    }
    if (
      (patch.options !== undefined || patch.style !== undefined) &&
      !this.handle.commitUpdate &&
      !this.handle.update
    ) {
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message: `Layer "${this.id}" does not support options updates.`,
        stage: 'layer-update',
      });
    }
    const { expectedVersion: _expectedVersion, ...rest } = patch;
    const enginePatch = {
      ...rest,
      ...(patch.visible !== undefined ? { visible: patch.visible && this.inheritedVisible } : {}),
      ...(patch.legend !== undefined ? { legend: nextLegend ?? null } : {}),
      ...(patch.style !== undefined ? { style: nextStyle } : {}),
    };
    const commitUpdate = this.handle.commitUpdate;
    if (Object.keys(enginePatch).length) {
      if (commitUpdate) {
        commitUpdate.call(this.handle, enginePatch);
      } else if (this.handle.update) {
        await this.handle.update(enginePatch);
      }
    }
    this.assertActive();
    this.transact(() => {
      if (!commitUpdate) {
        if (patch.zIndex !== undefined) {
          this.handle.setZIndex(patch.zIndex);
        }
        if (patch.visible !== undefined) {
          this.applyVisibility(patch.visible && this.inheritedVisible);
        }
      }
      if (patch.visible !== undefined) {
        this.currentVisible = patch.visible;
      }
      if (patch.title !== undefined) {
        this.currentTitle = patch.title;
      }
      this.currentLegend = nextLegend;
      this.currentStyle = nextStyle;
      this.currentVersion++;
      this.changed(
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
    this.disposal = this.updates.then(() => this.onDispose());
    this.changed();
    return this.disposal;
  }

  getMetadata(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      id: this.id,
      type: this.type,
      title: this.title,
      ...this.handle.getMetadata?.(),
    });
  }

  getInternalHandle(): MapLayerHandle {
    return this.handle;
  }

  private assertActive(): void {
    this.assertMutable();
    if (this.currentStatus === 'disposed') {
      throw new GISRuntimeError({
        code: 'APP_DISPOSED',
        message: `Layer "${this.id}" has been disposed.`,
        stage: 'layer-operation',
      });
    }
  }
}
