import type { LayerTreeItem } from '../types/layer.js';
import type { LayerInstanceImpl } from './layer-instance.js';

interface LayerNodeBase {
  readonly instance: LayerInstanceImpl;
  parent: GroupNode | undefined;
}

interface GroupNode extends LayerNodeBase {
  readonly kind: 'group';
  readonly children: LayerNode[];
}

interface LeafNode extends LayerNodeBase {
  readonly kind: 'leaf';
}

export type LayerNode = GroupNode | LeafNode;

export class LayerTree {
  private readonly nodes = new Map<string, LayerNode>();

  get(id: string): LayerInstanceImpl | undefined {
    return this.nodes.get(id)?.instance;
  }

  getGroup(id: string): GroupNode | undefined {
    const node = this.nodes.get(id);
    return node?.kind === 'group' ? node : undefined;
  }

  ids(): IterableIterator<string> {
    return this.nodes.keys();
  }

  list(): LayerInstanceImpl[] {
    return [...this.nodes.values()].map(({ instance }) => instance);
  }

  stageGroup(instance: LayerInstanceImpl, children: LayerNode[]): GroupNode {
    const group: GroupNode = { kind: 'group', instance, children, parent: undefined };
    for (const child of children) {
      child.parent = group;
    }
    return group;
  }

  isActive(node: LayerNode): boolean {
    let ancestor: LayerNode | undefined = node;
    while (ancestor) {
      if (
        ancestor.instance.status !== 'ready' ||
        this.nodes.get(ancestor.instance.id) !== ancestor
      ) {
        return false;
      }
      ancestor = ancestor.parent;
    }
    return true;
  }

  snapshot(): readonly LayerTreeItem[] {
    const nodes = [...this.nodes.values()];
    const rank = new Map(nodes.map((node, index) => [node, index]));
    const children = (siblings: readonly LayerNode[]): readonly LayerTreeItem[] =>
      Object.freeze(
        siblings
          .map((node) => {
            const nested = node.kind === 'group' ? children(node.children) : Object.freeze([]);
            const zIndex = nested.length
              ? Math.max(...nested.map(({ id }) => scores.get(id)!))
              : node.instance.zIndex;
            scores.set(node.instance.id, zIndex);
            return {
              rank: rank.get(node)!,
              zIndex,
              item: Object.freeze({
                id: node.instance.id,
                kind: node.kind,
                parentId: node.parent?.instance.id ?? null,
                children: nested,
              }),
            };
          })
          .sort((left, right) => left.zIndex - right.zIndex || left.rank - right.rank)
          .map(({ item }) => item)
      );
    const scores = new Map<string, number>();
    return children(nodes.filter((node) => !node.parent));
  }

  leaves(id: string): LayerInstanceImpl[] {
    const node = this.nodes.get(id);
    return node ? layerLeaves(node) : [];
  }

  publish(nodes: Iterable<LayerNode>, root: LayerNode, parent?: GroupNode): void {
    if (parent) {
      parent.children.push(root);
      root.parent = parent;
    }
    for (const node of nodes) {
      this.nodes.set(node.instance.id, node);
    }
  }

  remove(node: LayerNode): boolean {
    const { parent, instance } = node;
    if (parent) {
      const index = parent.children.indexOf(node);
      if (index !== -1) {
        parent.children.splice(index, 1);
      }
      node.parent = undefined;
    }
    return this.nodes.get(instance.id) === node && this.nodes.delete(instance.id);
  }

  setOrder(ids: readonly string[]): void {
    const nodes = ids.map((id) => this.nodes.get(id)!);
    this.nodes.clear();
    for (const node of nodes) {
      this.nodes.set(node.instance.id, node);
    }
  }
}

export function groupChildren(group: GroupNode): LayerInstanceImpl[] {
  return group.children.map(({ instance }) => instance);
}

export function layerLeaves(node: LayerNode): LayerInstanceImpl[] {
  return node.kind === 'leaf' ? [node.instance] : node.children.flatMap(layerLeaves);
}
