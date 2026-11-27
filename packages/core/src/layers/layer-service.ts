import { layerCapability } from './layer-capabilities.js';
import { applyEngineEffects } from './layer-engine-effects.js';
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
  MapLocation,
  MapService,
  Unsubscribe,
} from '../types.js';
import type { LayerInstanceImpl } from './layer-instance.js';
import { LayerCreation } from './layer-creation.js';
import { groupChildren, LayerTree } from './layer-tree.js';

export type LayerEvent = {
  type: 'add' | 'remove' | 'update' | 'order' | 'visibility';
  id?: string;
  visible?: boolean;
};
type LayerListener = (event: LayerEvent) => void;

export class LayerServiceImpl implements LayerService {
  private readonly tasks = new Set<Promise<LayerInstance>>();
  private readonly definitions = new Map<string, LayerTypeDefinition>();
  private readonly tree = new LayerTree();
  private readonly creation: LayerCreation;
  private readonly listeners = new Set<LayerListener>();
  private mutationEvents?: LayerEvent[];
  private readonly queuedMutationEvents: LayerEvent[] = [];
  private mutationDepth = 0;

  constructor(
    private readonly map: MapService,
    private readonly dependencies: ServiceDependencies
  ) {
    this.creation = new LayerCreation(this.tree, {
      map,
      context: () => this.context,
      definition: (type) => this.definitions.get(type),
      assertCanMutate: (action) => this.assertCanMutate(action),
      layerNotFound: (id) => this.layerNotFound(id),
      changed: () => this.changed(),
      publish: (event) => this.publish(event),
      emit: (event) => this.emit(event),
      layerChanged: (instance, event) => this.layerChanged(instance, event),
      batchMutation: (operation) => this.batchMutation(operation),
    });
  }
  private get context(): AppContext {
    return this.dependencies.context();
  }
  private changed(): void {
    const selected = this.context.interactions.getSelection();
    if (
      selected &&
      (!selected.source || selected.source === 'layer') &&
      (!this.tree.get(selected.layerId) || !this.canSelectFeature(selected))
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
    this.mutationDepth++;
    try {
      this.dependencies.state.batch(() => {
        this.mutationEvents = events;
        try {
          operation();
        } finally {
          this.mutationEvents = undefined;
          this.queuedMutationEvents.push(...events);
        }
      });
    } finally {
      if (--this.mutationDepth === 0) {
        this.flushMutationEvents();
      }
    }
  }

  private flushMutationEvents(): void {
    this.mutationDepth++;
    try {
      for (const event of this.queuedMutationEvents) {
        this.publish(event);
      }
    } finally {
      this.queuedMutationEvents.length = 0;
      this.mutationDepth--;
    }
  }

  private layerChanged(instance: LayerInstanceImpl, event?: LayerEvent): void {
    if (this.tree.get(instance.id) !== instance) {
      return;
    }
    if (event) {
      if (this.mutationEvents) {
        this.mutationEvents.push(event);
      } else {
        this.emit(event);
        return;
      }
    }
    this.changed();
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
    return this.trackAddition(this.creation.addTree(config));
  }

  prepareInitial(configs: readonly LayerConfig[]): readonly LayerConfig[] {
    return configs.map((config, index) => this.creation.prepare(config, `layers[${index}]`));
  }

  addPrepared(config: LayerConfig): Promise<LayerInstance> {
    return this.trackAddition(this.creation.addPreparedTree(config));
  }

  async addChild(groupId: string, config: LayerConfig): Promise<LayerInstance> {
    const group = this.tree.get(groupId);
    if (!group) {
      throw this.layerNotFound(groupId);
    }
    const parent = this.tree.getGroup(groupId);
    if (!parent || !this.tree.isActive(parent)) {
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message: `Layer "${groupId}" is not an active group.`,
        stage: 'layer-create',
      });
    }
    return this.trackAddition(this.creation.addTree(config, parent));
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
    await Promise.all(this.tree.list().map((instance) => instance.settleUpdates()));
  }

  async remove(id: string): Promise<void> {
    const instance = this.tree.get(id);
    if (!instance) {
      throw this.layerNotFound(id);
    }
    await instance.dispose();
  }

  async update(id: string, patch: LayerUpdate): Promise<void> {
    this.assertCanMutate('update a layer');
    const instance = this.tree.get(id);
    if (!instance) {
      throw this.layerNotFound(id);
    }
    await instance.update(patch);
  }

  get(id: string): LayerInstance | undefined {
    return this.tree.get(id);
  }
  has(id: string): boolean {
    return this.tree.get(id) !== undefined;
  }
  list(): LayerInstance[] {
    return this.tree.list();
  }

  getTree() {
    return this.tree.snapshot();
  }

  getChildren(id: string): readonly LayerInstance[] {
    const group = this.tree.getGroup(id);
    return Object.freeze(group ? groupChildren(group) : []);
  }

  getLeaves(id: string): readonly LayerInstance[] {
    return Object.freeze(this.tree.leaves(id));
  }

  canSelectFeature(feature: FeatureReference): boolean {
    if (feature.source && feature.source !== 'layer') {
      return true;
    }
    const layer = this.tree.get(feature.layerId);
    if (!layer) {
      return feature.featureKey === undefined;
    }
    return (
      layer.visible &&
      layer.status === 'ready' &&
      layerCapability(layer.getInternalHandle(), 'feature')?.canSelectFeature?.(feature) !== false
    );
  }

  identify(
    id: string,
    query: LayerIdentifyQuery
  ): Promise<readonly FeaturePickCandidate[]> | undefined {
    const layer = this.tree.get(id);
    if (!layer?.visible || layer.status !== 'ready') {
      return;
    }
    const capability = layerCapability(layer.getInternalHandle(), 'feature');
    const identify = capability?.identify;
    if (!identify) {
      return;
    }
    return Promise.resolve().then(async () => {
      query.signal.throwIfAborted();
      const hits = await identify.call(capability, query);
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
    const instance = this.tree.get(id);
    if (!instance) {
      throw this.layerNotFound(id);
    }
    if (instance.status === 'disposed') {
      return undefined;
    }
    const group = this.tree.getGroup(id);
    const location = group
      ? this.getGroupLocation(groupChildren(group))
      : layerCapability(instance.getInternalHandle(), 'location')?.getDataLocation?.();
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
    const instance = this.tree.get(id);
    if (!instance) {
      throw this.layerNotFound(id);
    }
    instance.setVisibility(visible);
  }

  setOrder(ids: string[]): void {
    this.assertCanMutate('order layers');
    const currentIds = [...this.tree.ids()];
    if (
      ids.length !== currentIds.length ||
      new Set(ids).size !== currentIds.length ||
      ids.some((id) => !this.tree.get(id))
    ) {
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message: 'Layer order must contain each registered layer exactly once.',
        stage: 'layer-order',
        detail: { path: 'layers.order' },
      });
    }
    const adapter = this.map.getAdapter();
    const leaves = ids
      .map((id) => this.tree.get(id)!)
      .flatMap((instance) => {
        const handle = instance.getInternalHandle();
        instance.assertIdle();
        return handle ? [{ instance, handle, previousZIndex: instance.zIndex }] : [];
      });
    const previousHandles = this.tree.list().flatMap((instance) => {
      const handle = instance.getInternalHandle();
      return handle ? [handle] : [];
    });
    applyEngineEffects(
      [
        {
          apply: () => adapter.setLayerOrder(leaves.map(({ handle }) => handle)),
          rollback: () => adapter.setLayerOrder(previousHandles),
        },
        ...leaves.map(({ handle, previousZIndex }, index) => ({
          apply: () => handle.setZIndex(index),
          rollback: () => handle.setZIndex(previousZIndex),
        })),
      ],
      'layer-order'
    );
    leaves.forEach(({ instance }, index) => instance.recordZIndex(index));
    this.tree.setOrder(ids);
    this.emit({ type: 'order' });
  }

  async clear(): Promise<void> {
    const errors: unknown[] = [];
    for (const instance of this.tree.list().reverse()) {
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

  private getGroupLocation(children: LayerInstanceImpl[]): MapLocation | undefined {
    const locations = children
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
