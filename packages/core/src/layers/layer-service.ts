import { normalizeLayerInput, normalizeLayerLegend } from '../config/app-config.js';
import type { ServiceDependencies } from '../context/service-dependencies.js';
import { GISRuntimeError } from '../errors.js';
import type {
  AppContext,
  FeaturePickCandidate,
  FeatureReference,
  LayerConfig,
  LayerIdentifyQuery,
  LayerInstance,
  LayerService,
  LayerTypeDefinition,
  LayerUpdate,
  MapAdapter,
  MapLayerHandle,
  MapLocation,
  MapService,
  Unsubscribe,
} from '../types.js';
import { LayerInstanceImpl } from './layer-instance.js';

type LayerEvent = {
  type: 'add' | 'remove' | 'update' | 'order' | 'visibility';
  id?: string;
  visible?: boolean;
};
type LayerListener = (event: LayerEvent) => void;

interface LayerAddition {
  reserved: Set<string>;
  staged: Map<string, LayerInstanceImpl>;
  cleanupErrors: unknown[];
}

async function releaseLayer(
  adapter: MapAdapter,
  handle: MapLayerHandle,
  attachAttempted: boolean
): Promise<unknown[]> {
  const errors: unknown[] = [];
  if (attachAttempted) {
    try {
      adapter.removeLayer(handle);
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await handle.dispose();
  } catch (error) {
    errors.push(error);
  }
  return errors;
}

export class LayerServiceImpl implements LayerService {
  private readonly pending = new Set<string>();
  private readonly tasks = new Set<Promise<LayerInstance>>();
  private readonly definitions = new Map<string, LayerTypeDefinition>();
  private readonly instances = new Map<string, LayerInstanceImpl>();
  private readonly groupMembers = new WeakMap<LayerInstanceImpl, Set<LayerInstanceImpl>>();
  private readonly memberships = new WeakMap<LayerInstanceImpl, Set<LayerInstanceImpl>>();
  private readonly listeners = new Set<LayerListener>();
  private mutationEvents?: LayerEvent[];

  constructor(
    private readonly map: MapService,
    private readonly dependencies: ServiceDependencies
  ) {}
  private get context(): AppContext {
    return this.dependencies.context();
  }
  private changed(): void {
    const selected = this.context.interactions.getSelection();
    if (
      selected &&
      (!selected.source || selected.source === 'layer') &&
      (!this.instances.has(selected.layerId) || !this.canSelectFeature(selected))
    ) {
      this.context.interactions.clearSelection();
    }
    this.dependencies.state.refresh();
  }

  private batchMutation(operation: () => void): void {
    if (this.mutationEvents) {
      operation();
      return;
    }
    const events: LayerEvent[] = [];
    this.mutationEvents = events;
    try {
      this.dependencies.state.batch(operation);
    } finally {
      this.mutationEvents = undefined;
      for (const event of events) {
        this.publish(event);
      }
    }
  }

  private layerChanged(instance: LayerInstanceImpl, event?: LayerEvent): void {
    if (this.instances.get(instance.id) !== instance) {
      return;
    }
    this.changed();
    if (event) {
      this.mutationEvents!.push(event);
    }
  }

  registerType(type: string, definition: LayerTypeDefinition): void {
    if (!type.trim() || this.definitions.has(type)) {
      throw new GISRuntimeError({
        code: 'LAYER_TYPE_DUPLICATE',
        message: `Layer type "${type}" is invalid or already registered.`,
        stage: 'layer-type-registration',
      });
    }
    this.definitions.set(type, definition);
  }

  unregisterType(type: string, definition: LayerTypeDefinition): void {
    if (this.definitions.get(type) === definition) {
      this.definitions.delete(type);
    }
  }

  add(config: LayerConfig): Promise<LayerInstance> {
    return this.trackAddition(this.addTree(config));
  }

  async addChild(groupId: string, config: LayerConfig): Promise<LayerInstance> {
    const group = this.instances.get(groupId);
    if (!group) {
      throw this.layerNotFound(groupId);
    }
    if (!this.groupMembers.has(group) || group.status !== 'ready') {
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message: `Layer "${groupId}" is not an active group.`,
        stage: 'layer-create',
      });
    }
    return this.trackAddition(this.addTree(config, group));
  }

  private async trackAddition(task: Promise<LayerInstance>): Promise<LayerInstance> {
    this.tasks.add(task);
    try {
      return await task;
    } finally {
      this.tasks.delete(task);
    }
  }

  async settle(): Promise<void> {
    while (this.tasks.size) {
      await Promise.allSettled([...this.tasks]);
    }
    await Promise.all([...this.instances.values()].map((instance) => instance.settleUpdates()));
  }

  private async addTree(input: LayerConfig, parent?: LayerInstanceImpl): Promise<LayerInstance> {
    this.assertCanMutate('add a layer');
    const config = normalizeLayerInput(input);
    const addition: LayerAddition = { reserved: new Set(), staged: new Map(), cleanupErrors: [] };
    try {
      const root = await this.addReserved(config, addition);
      this.assertCanMutate('publish a layer');
      if (parent) {
        if (this.instances.get(parent.id) !== parent || parent.status !== 'ready') {
          throw this.layerNotFound(parent.id);
        }
        root.inheritVisibility(parent.visible);
        const members = this.groupMembers.get(parent)!;
        members.add(root);
        this.memberships.set(root, members);
      }
      const entries = [...addition.staged];
      // Publish the complete tree before any observer can read its children.
      for (const [id, instance] of entries) {
        this.instances.set(id, instance);
      }
      addition.staged.clear();
      this.changed();
      for (const [id] of entries) {
        this.publish({ type: 'add', id });
      }
      return root;
    } catch (cause) {
      for (const layer of [...addition.staged.values()].reverse()) {
        if (layer.status === 'disposed') {
          continue;
        }
        try {
          await layer.dispose();
        } catch (cleanupError) {
          addition.cleanupErrors.push(cleanupError);
        }
      }
      if (addition.cleanupErrors.length) {
        const error = cause instanceof GISRuntimeError ? cause : undefined;
        throw new GISRuntimeError({
          code: error?.code ?? 'LAYER_CREATE_FAILED',
          message: error?.message ?? `Layer "${config.id}" creation failed.`,
          stage: error?.stage ?? 'layer-create',
          detail: error?.detail,
          cause,
          cleanupErrors: [...(error?.cleanupErrors ?? []), ...addition.cleanupErrors],
        });
      }
      throw cause;
    } finally {
      addition.staged.clear();
      for (const id of addition.reserved) {
        this.pending.delete(id);
      }
      addition.reserved.clear();
    }
  }

  private async addReserved(
    config: LayerConfig,
    addition: LayerAddition
  ): Promise<LayerInstanceImpl> {
    this.assertCanMutate('add a layer');
    if (this.instances.has(config.id) || this.pending.has(config.id)) {
      throw new GISRuntimeError({
        code: 'LAYER_DUPLICATE',
        message: `Layer "${config.id}" already exists.`,
        stage: 'layer-create',
        detail: { layerId: config.id },
      });
    }
    this.pending.add(config.id);
    addition.reserved.add(config.id);
    return this.createLayer(config, addition);
  }

  private async createLayer(
    inputConfig: LayerConfig,
    addition: LayerAddition
  ): Promise<LayerInstanceImpl> {
    const config =
      inputConfig.legend === undefined
        ? inputConfig
        : Object.freeze({
            ...inputConfig,
            legend: normalizeLayerLegend(inputConfig.legend, inputConfig.id),
          });
    if (config.type === 'GROUP') {
      return this.addGroup(config, addition);
    }
    const definition = this.definitions.get(config.type);
    if (!definition) {
      throw new GISRuntimeError({
        code: 'LAYER_TYPE_NOT_FOUND',
        message: `Layer type "${config.type}" is not registered.`,
        stage: 'layer-create',
        detail: { path: `layers.${config.id}.type` },
      });
    }
    const adapter = this.map.getAdapter();
    const handle = await definition.create(this.context, config);
    let attachAttempted = false;
    try {
      this.assertCanMutate('finish adding a layer');
      if (config.visible === false) {
        handle.setVisible(false);
      }
      if (config.zIndex !== undefined) {
        handle.setZIndex(config.zIndex);
      }
      attachAttempted = true;
      adapter.addLayer(handle);
      const instance: LayerInstanceImpl = new LayerInstanceImpl(
        config.id,
        config.type,
        config.title,
        config.visible ?? true,
        handle,
        async () => {
          let errors: unknown[];
          try {
            errors = await releaseLayer(adapter, handle, true);
          } finally {
            this.detachMember(instance);
            if (this.instances.get(config.id) === instance) {
              this.instances.delete(config.id);
              const selected = this.context.interactions.getSelection();
              if (
                selected?.layerId === config.id &&
                (!selected.source || selected.source === 'layer')
              ) {
                this.context.interactions.clearSelection();
              }
              this.emit({ type: 'remove', id: config.id });
            }
          }
          if (errors.length) {
            throw new GISRuntimeError({
              code: 'APP_DISPOSE_FAILED',
              message: `Layer "${config.id}" cleanup failed.`,
              cleanupErrors: errors,
            });
          }
        },
        (event) => this.layerChanged(instance, event),
        (operation) => this.batchMutation(operation),
        () => this.assertCanMutate('update a layer'),
        config.legend,
        config.style
      );
      addition.staged.set(config.id, instance);
      return instance;
    } catch (cause) {
      addition.cleanupErrors.push(...(await releaseLayer(adapter, handle, attachAttempted)));
      throw cause;
    }
  }

  async remove(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      throw this.layerNotFound(id);
    }
    await instance.dispose();
  }

  async update(id: string, patch: LayerUpdate): Promise<void> {
    this.assertCanMutate('update a layer');
    const instance = this.instances.get(id);
    if (!instance) {
      throw this.layerNotFound(id);
    }
    await instance.update(patch);
  }

  get(id: string): LayerInstance | undefined {
    return this.instances.get(id);
  }
  has(id: string): boolean {
    return this.instances.has(id);
  }
  list(): LayerInstance[] {
    return [...this.instances.values()];
  }

  canSelectFeature(feature: FeatureReference): boolean {
    if (feature.source && feature.source !== 'layer') {
      return true;
    }
    const layer = this.instances.get(feature.layerId);
    if (!layer) {
      return feature.featureKey === undefined;
    }
    return (
      layer.visible &&
      layer.status === 'ready' &&
      layer.getInternalHandle().canSelectFeature?.(feature) !== false
    );
  }

  identify(
    id: string,
    query: LayerIdentifyQuery
  ): Promise<readonly FeaturePickCandidate[]> | undefined {
    const layer = this.instances.get(id);
    if (!layer?.visible || layer.status !== 'ready') {
      return;
    }
    const handle = layer.getInternalHandle();
    const identify = handle.identify;
    if (!identify) {
      return;
    }
    return Promise.resolve().then(async () => {
      query.signal.throwIfAborted();
      const hits = await identify.call(handle, query);
      return hits.map(({ id: featureId, featureKey, title, properties, geometryType }) => ({
        layerId: id,
        id: featureId,
        featureKey,
        title,
        properties,
        geometryType,
      }));
    });
  }

  getDataLocation(id: string): MapLocation | undefined {
    const instance = this.instances.get(id);
    if (!instance) {
      throw this.layerNotFound(id);
    }
    if (instance.status === 'disposed') {
      return undefined;
    }
    const location = instance.getInternalHandle().getDataLocation?.();
    if (!location) {
      return undefined;
    }
    if (location.extent) {
      const [minX, minY, maxX, maxY] = location.extent;
      if (
        location.extent.length !== 4 ||
        !location.extent.every(Number.isFinite) ||
        minX > maxX ||
        minY > maxY
      ) {
        return undefined;
      }
      return minX === maxX && minY === maxY
        ? { coordinate: [minX, minY], projection: location.projection }
        : { extent: [minX, minY, maxX, maxY], projection: location.projection };
    }
    return location.coordinate?.length === 2 && location.coordinate.every(Number.isFinite)
      ? {
          coordinate: [location.coordinate[0], location.coordinate[1]],
          projection: location.projection,
        }
      : undefined;
  }

  setVisibility(id: string, visible: boolean): void {
    const instance = this.instances.get(id);
    if (!instance) {
      throw this.layerNotFound(id);
    }
    instance.setVisibility(visible);
  }

  setOrder(ids: string[]): void {
    this.assertCanMutate('order layers');
    const currentIds = [...this.instances.keys()];
    if (
      ids.length !== currentIds.length ||
      new Set(ids).size !== currentIds.length ||
      ids.some((id) => !this.instances.has(id))
    ) {
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message: 'Layer order must contain each registered layer exactly once.',
        stage: 'layer-order',
        detail: { path: 'layers.order' },
      });
    }
    const adapter = this.map.getAdapter();
    const layerHandles = ids
      .map((id) => this.instances.get(id)!)
      .filter((instance) => instance.type !== 'GROUP')
      .map((instance) => this.getHandle(instance));
    adapter.setLayerOrder(layerHandles);
    // An explicit order takes precedence over earlier per-layer zIndex values.
    layerHandles.forEach((handle, index) => handle.setZIndex(index));
    const ordered = ids.map((id) => this.instances.get(id)!);
    this.instances.clear();
    for (const instance of ordered) {
      this.instances.set(instance.id, instance);
    }
    this.emit({ type: 'order' });
  }

  async clear(): Promise<void> {
    const errors: unknown[] = [];
    for (const instance of [...this.instances.values()].reverse()) {
      try {
        await instance.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      throw new GISRuntimeError({
        code: 'APP_DISPOSE_FAILED',
        message: `${errors.length} layer(s) failed to dispose.`,
        stage: 'layer-clear',
        cleanupErrors: errors,
      });
    }
  }

  subscribe(listener: LayerListener): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private getHandle(instance: LayerInstanceImpl): MapLayerHandle {
    return instance.getInternalHandle();
  }

  private assertCanMutate(action: string): void {
    const status = this.dependencies.state.status;
    if (!['initializing', 'ready', 'mounted', 'unmounted'].includes(status)) {
      throw new GISRuntimeError({
        code:
          status === 'disposed' || status === 'disposing' ? 'APP_DISPOSED' : 'APP_INVALID_STATE',
        message: `Cannot ${action} while the app is ${status}.`,
        stage: 'layer-operation',
      });
    }
  }

  private async addGroup(config: LayerConfig, addition: LayerAddition): Promise<LayerInstanceImpl> {
    if (!config.children?.length) {
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message: `Group layer "${config.id}" must contain at least one child.`,
        stage: 'layer-create',
        detail: { path: `layers.${config.id}.children` },
      });
    }
    const children = new Set<LayerInstanceImpl>();
    for (const child of config.children) {
      const instance = await this.addReserved(child, addition);
      children.add(instance);
      this.memberships.set(instance, children);
    }
    this.assertCanMutate('finish adding a group layer');
    const lookup = (id: string) => this.instances.get(id) ?? addition.staged.get(id);
    const liveChildren = () =>
      [...children].filter((child) => lookup(child.id) === child && child.status === 'ready');

    const visible = config.visible ?? true;
    const groupLeaves = (): LayerInstanceImpl[] => {
      const collect = (items: LayerInstanceImpl[]): LayerInstanceImpl[] =>
        items.flatMap((child) => {
          if (lookup(child.id) !== child) {
            return [];
          }
          if (child.type !== 'GROUP') {
            return [child];
          }
          const ids = child.getMetadata().childIds;
          return collect(
            Array.isArray(ids)
              ? ids.flatMap((id) => {
                  const current = lookup(String(id));
                  return current ? [current] : [];
                })
              : []
          );
        });
      return collect([...children]);
    };
    const handle: MapLayerHandle = {
      getDataLocation: () => {
        const locations = [...children]
          .filter((child) => this.get(child.id) === child)
          .flatMap((child) => {
            const location = this.getDataLocation(child.id);
            return location ? [location] : [];
          });
        if (!locations.length) {
          return undefined;
        }
        const projection =
          locations[0]!.projection ?? this.context.state.snapshot().map.projection ?? undefined;
        if (
          locations.some(
            (location) =>
              (location.projection ?? this.context.state.snapshot().map.projection ?? undefined) !==
              projection
          )
        ) {
          throw new GISRuntimeError({
            code: 'CONFIG_INVALID',
            message: 'Group data locations must use the same projection.',
            stage: 'layer-location',
          });
        }
        const bounds = locations.map(
          (location) =>
            location.extent ?? [
              location.coordinate![0],
              location.coordinate![1],
              location.coordinate![0],
              location.coordinate![1],
            ]
        );
        return {
          extent: [
            Math.min(...bounds.map((extent) => extent[0]!)),
            Math.min(...bounds.map((extent) => extent[1]!)),
            Math.max(...bounds.map((extent) => extent[2]!)),
            Math.max(...bounds.map((extent) => extent[3]!)),
          ],
          projection,
        };
      },
      setVisible: () => {},
      setZIndex: (value) => {
        const leaves = groupLeaves().sort(
          (leftLayer, rightLayer) =>
            Number(leftLayer.getMetadata().zIndex ?? 0) -
            Number(rightLayer.getMetadata().zIndex ?? 0)
        );
        leaves.forEach((leaf, index) =>
          leaf.getInternalHandle().setZIndex(value + index / leaves.length)
        );
      },
      dispose: async () => {
        const errors: unknown[] = [];
        for (const child of [...children].reverse()) {
          try {
            if (lookup(child.id) === child) {
              await child.dispose();
            }
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length) {
          throw new GISRuntimeError({
            code: 'APP_DISPOSE_FAILED',
            message: `Group "${config.id}" child cleanup failed.`,
            stage: 'group-dispose',
            cleanupErrors: errors,
          });
        }
      },
      getMetadata: () => {
        const leaves = groupLeaves();
        return {
          childIds: [...children]
            .filter((child) => lookup(child.id) === child)
            .map((child) => child.id),
          zIndex: leaves.length
            ? Math.max(...leaves.map((leaf) => Number(leaf.getMetadata().zIndex ?? 0)))
            : (config.zIndex ?? 0),
        };
      },
    };
    const group: LayerInstanceImpl = new LayerInstanceImpl(
      config.id,
      'GROUP',
      config.title,
      visible,
      handle,
      async () => {
        try {
          await handle.dispose?.();
        } finally {
          this.detachMember(group);
          if (this.instances.get(config.id) === group) {
            this.instances.delete(config.id);
            this.emit({ type: 'remove', id: config.id });
          }
        }
      },
      (event) => this.layerChanged(group, event),
      (operation) => this.batchMutation(operation),
      () => this.assertCanMutate('update a group layer'),
      config.legend,
      undefined,
      liveChildren
    );
    if (!visible) {
      group.inheritVisibility(true);
    }
    if (config.zIndex !== undefined) {
      handle.setZIndex(config.zIndex);
    }
    this.groupMembers.set(group, children);
    addition.staged.set(config.id, group);
    return group;
  }

  private detachMember(layer: LayerInstanceImpl): void {
    this.memberships.get(layer)?.delete(layer);
    this.memberships.delete(layer);
  }

  private layerNotFound(id: string): GISRuntimeError {
    return new GISRuntimeError({
      code: 'LAYER_NOT_FOUND',
      message: `Layer "${id}" was not found.`,
      stage: 'layer-operation',
      detail: { layerId: id },
    });
  }

  private emit(event: LayerEvent): void {
    this.changed();
    this.publish(event);
  }

  private publish(event: LayerEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (cause) {
        this.context.events.emit('app:error', {
          error: new GISRuntimeError({
            code: 'APP_INVALID_STATE',
            message: 'Layer observer failed.',
            stage: 'event-listener',
            cause,
          }),
        });
      }
    }
  }
}
