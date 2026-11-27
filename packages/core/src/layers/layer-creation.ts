import { normalizeLayerInput, normalizeLayerLegend } from '../config/app-config.js';
import { GISRuntimeError } from '../errors.js';
import type {
  AppContext,
  LayerConfig,
  LayerInstance,
  LayerTypeDefinition,
  MapAdapter,
  MapLayerHandle,
  MapService,
} from '../types.js';
import { LayerInstanceImpl } from './layer-instance.js';
import type { LayerEvent } from './layer-service.js';
import { groupChildren, layerLeaves, type LayerTree, type LayerNode } from './layer-tree.js';

interface LayerCreationPort {
  map: MapService;
  context(): AppContext;
  definition(type: string): LayerTypeDefinition | undefined;
  assertCanMutate(action: string): void;
  layerNotFound(id: string): GISRuntimeError;
  changed(): void;
  publish(event: LayerEvent): void;
  emit(event: LayerEvent): void;
  layerChanged(instance: LayerInstanceImpl, event?: LayerEvent): void;
  batchMutation(operation: () => void): void;
}

interface LayerAddition {
  reserved: Set<string>;
  staged: LayerNode[];
  attachments: (() => void)[];
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

export class LayerCreation {
  private readonly pending = new Set<string>();

  constructor(
    private readonly tree: LayerTree,
    private readonly port: LayerCreationPort
  ) {}

  async addTree(
    input: LayerConfig,
    parent?: Extract<LayerNode, { kind: 'group' }>
  ): Promise<LayerInstance> {
    this.port.assertCanMutate('add a layer');
    const config = normalizeLayerInput(input);
    return this.addPreparedTree(this.prepareConfig(config, `layers.${config.id}`), parent);
  }

  prepare(input: LayerConfig, path: string): LayerConfig {
    return this.prepareConfig(normalizeLayerInput(input), path);
  }

  private prepareConfig(config: LayerConfig, path: string): LayerConfig {
    if (config.type === 'GROUP') {
      const children = config.children?.map((child, index) =>
        this.prepareConfig(child, `${path}.children[${index}]`)
      );
      return Object.freeze({ ...config, children: children && Object.freeze(children) });
    }
    const definition = this.requireDefinition(config, path);
    if (!definition.normalize) {
      return config;
    }
    try {
      const normalized = normalizeLayerInput(definition.normalize(config));
      if (
        normalized.id !== config.id ||
        normalized.type !== config.type ||
        normalized.children !== undefined
      ) {
        throw new Error('Layer normalization must preserve the layer identity and topology.');
      }
      return normalized;
    } catch (cause) {
      const detail = cause instanceof GISRuntimeError ? cause.detail : undefined;
      const field =
        detail && typeof detail === 'object' && 'path' in detail && typeof detail.path === 'string'
          ? detail.path.replace(/^layer\./, '')
          : undefined;
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message:
          cause instanceof Error
            ? cause.message
            : `Invalid configuration for layer "${config.id}".`,
        stage: 'config-validation',
        detail: { layerId: config.id, path: field ? `${path}.${field}` : path },
        cause,
      });
    }
  }

  async addPreparedTree(
    config: LayerConfig,
    parent?: Extract<LayerNode, { kind: 'group' }>
  ): Promise<LayerInstance> {
    this.port.assertCanMutate('add a layer');
    const addition: LayerAddition = {
      reserved: new Set(),
      staged: [],
      attachments: [],
      cleanupErrors: [],
    };
    try {
      this.reserve(config, addition);
      const root = await this.createLayer(config, addition);
      this.port.assertCanMutate('publish a layer');
      if (parent) {
        if (!this.tree.isActive(parent)) {
          throw this.port.layerNotFound(parent.instance.id);
        }
        root.instance.inheritVisibility(parent.instance.visible);
      }
      for (const attach of addition.attachments) {
        attach();
      }
      this.port.assertCanMutate('publish a layer');
      if (parent && !this.tree.isActive(parent)) {
        throw this.port.layerNotFound(parent.instance.id);
      }
      const entries = addition.staged.splice(0);
      // Publish the complete tree before any observer can read its children.
      this.tree.publish(entries, root, parent);
      this.port.changed();
      for (const { instance } of entries) {
        this.port.publish({ type: 'add', id: instance.id });
      }
      return root.instance;
    } catch (cause) {
      await this.releaseStaged(addition);
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
      addition.staged.length = 0;
      for (const id of addition.reserved) {
        this.pending.delete(id);
      }
      addition.reserved.clear();
    }
  }

  private requireDefinition(config: LayerConfig, path: string): LayerTypeDefinition {
    const definition = this.port.definition(config.type);
    if (!definition) {
      throw new GISRuntimeError({
        code: 'LAYER_TYPE_NOT_FOUND',
        message: `Layer type "${config.type}" is not registered.`,
        stage: 'layer-create',
        detail: { layerId: config.id, path: `${path}.type` },
      });
    }
    return definition;
  }

  private async releaseStaged(addition: LayerAddition): Promise<void> {
    for (const { instance: layer } of [...addition.staged].reverse()) {
      if (layer.status === 'disposed') {
        continue;
      }
      try {
        await layer.dispose();
      } catch (cleanupError) {
        this.collectCleanupError(addition, cleanupError);
      }
    }
  }

  private collectCleanupError(addition: LayerAddition, error: unknown): void {
    if (
      error instanceof GISRuntimeError &&
      error.code === 'APP_DISPOSE_FAILED' &&
      error.cleanupErrors?.length
    ) {
      for (const cause of error.cleanupErrors) {
        this.collectCleanupError(addition, cause);
      }
    } else {
      addition.cleanupErrors.push(error);
    }
  }

  private reserve(config: LayerConfig, addition: LayerAddition): void {
    if (this.tree.get(config.id) || this.pending.has(config.id)) {
      throw new GISRuntimeError({
        code: 'LAYER_DUPLICATE',
        message: `Layer "${config.id}" already exists.`,
        stage: 'layer-create',
        detail: { layerId: config.id },
      });
    }
    this.pending.add(config.id);
    addition.reserved.add(config.id);
    for (const child of config.children ?? []) {
      this.reserve(child, addition);
    }
  }

  private async createLayer(inputConfig: LayerConfig, addition: LayerAddition): Promise<LayerNode> {
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
    const definition = this.requireDefinition(config, `layers.${config.id}`);
    const adapter = this.port.map.getAdapter();
    const handle = await definition.create(this.port.context(), config);
    let attachAttempted = false;
    try {
      this.port.assertCanMutate('finish adding a layer');
      if (config.visible === false) {
        handle.setVisible(false);
      }
      if (config.zIndex !== undefined) {
        handle.setZIndex(config.zIndex);
      }
      const instance: LayerInstanceImpl = new LayerInstanceImpl({
        config,
        handle,
        onDispose: async () => {
          let errors: unknown[];
          try {
            errors = await releaseLayer(adapter, handle, attachAttempted);
          } finally {
            if (this.tree.remove(node)) {
              const selected = this.port.context().interactions.getSelection();
              if (
                selected?.layerId === config.id &&
                (!selected.source || selected.source === 'layer')
              ) {
                this.port.context().interactions.clearSelection();
              }
              this.port.emit({ type: 'remove', id: config.id });
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
        changed: (event) => this.port.layerChanged(instance, event),
        parentId: () => node.parent?.instance.id ?? null,
        transact: (operation) => this.port.batchMutation(operation),
        assertMutable: () => this.assertMutable(node),
      });
      const node: LayerNode = { kind: 'leaf', instance, parent: undefined };
      addition.staged.push(node);
      addition.attachments.push(() => {
        attachAttempted = true;
        adapter.addLayer(handle);
      });
      return node;
    } catch (cause) {
      addition.cleanupErrors.push(...(await releaseLayer(adapter, handle, attachAttempted)));
      throw cause;
    }
  }

  private async addGroup(config: LayerConfig, addition: LayerAddition): Promise<LayerNode> {
    if (!config.children?.length) {
      throw new GISRuntimeError({
        code: 'CONFIG_INVALID',
        message: `Group layer "${config.id}" must contain at least one child.`,
        stage: 'layer-create',
        detail: { path: `layers.${config.id}.children` },
      });
    }
    const children: LayerNode[] = [];
    for (const child of config.children) {
      children.push(await this.createLayer(child, addition));
    }
    this.port.assertCanMutate('finish adding a group layer');

    const group: LayerInstanceImpl = new LayerInstanceImpl({
      config,
      onDispose: async () => {
        const errors: unknown[] = [];
        try {
          for (const { instance } of [...children].reverse()) {
            try {
              await instance.dispose();
            } catch (error) {
              errors.push(error);
            }
          }
        } finally {
          if (this.tree.remove(node)) {
            this.port.emit({ type: 'remove', id: config.id });
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
      changed: (event) => this.port.layerChanged(group, event),
      parentId: () => node.parent?.instance.id ?? null,
      transact: (operation) => this.port.batchMutation(operation),
      assertMutable: () => this.assertMutable(node),
      children: () => groupChildren(node),
      leaves: () => layerLeaves(node),
    });
    const node = this.tree.stageGroup(group, children);
    addition.staged.push(node);
    if (!group.visible) {
      group.inheritVisibility(true);
    }
    if (config.zIndex !== undefined) {
      group.setZIndex(config.zIndex);
    }
    return node;
  }

  private assertMutable(node: LayerNode): void {
    this.port.assertCanMutate('update a layer');
    if (!this.tree.isActive(node)) {
      throw new GISRuntimeError({
        code: 'APP_DISPOSED',
        message: `Layer "${node.instance.id}" or its parent is being disposed.`,
        stage: 'layer-operation',
      });
    }
  }
}
