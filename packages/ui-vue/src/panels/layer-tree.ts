import type { LayerInstance, LayerService } from '@joinmap/gis-core';

export interface LayerNode {
  layer: LayerInstance;
  children: LayerNode[];
}

/** Retain matching nodes and their ancestors without changing Runtime ordering. */
export function filterLayerTree(nodes: readonly LayerNode[], keyword: string): LayerNode[] {
  const term = keyword.trim().toLocaleLowerCase();
  if (!term) {
    return [...nodes];
  }
  return nodes.flatMap((node) => {
    if ((node.layer.title || node.layer.id).toLocaleLowerCase().includes(term)) {
      return [node];
    }
    const children = filterLayerTree(node.children, term);
    return children.length ? [{ ...node, children }] : [];
  });
}

/** UI order is front-to-back; Runtime setOrder receives back-to-front IDs. */
export function layerTree(layers: readonly LayerInstance[]): LayerNode[] {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const rank = new Map(layers.map((layer, index) => [layer, index]));
  const childIds = new Set<string>();
  function children(layer: LayerInstance): LayerInstance[] {
    const ids = layer.getMetadata().childIds;
    return layer.type === 'GROUP' && Array.isArray(ids)
      ? ids.flatMap((id) => {
          const child = byId.get(String(id));
          return child ? [child] : [];
        })
      : [];
  }
  for (const layer of layers) {
    for (const child of children(layer)) {
      childIds.add(child.id);
    }
  }
  function score(node: LayerNode): number {
    if (node.children.length) {
      return Math.max(...node.children.map(score));
    }
    const value = node.layer.getMetadata().zIndex;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
  function build(items: readonly LayerInstance[], seen: Set<string>): LayerNode[] {
    return items
      .filter((layer) => !seen.has(layer.id))
      .map((layer) => ({
        layer,
        children: build(children(layer), new Set([...seen, layer.id])),
      }))
      .sort(
        (leftNode, rightNode) =>
          score(rightNode) - score(leftNode) ||
          rank.get(rightNode.layer)! - rank.get(leftNode.layer)!
      );
  }
  return build(
    layers.filter((layer) => !childIds.has(layer.id)),
    new Set()
  );
}

export function layerSiblings(nodes: LayerNode[], layer: LayerInstance): LayerNode[] | undefined {
  if (nodes.some((node) => node.layer === layer)) {
    return nodes;
  }
  for (const node of nodes) {
    const siblings = layerSiblings(node.children, layer);
    if (siblings) {
      return siblings;
    }
  }
}

export function moveLayer(service: LayerService, layer: LayerInstance, direction: -1 | 1): void {
  const nodes = layerTree(service.list());
  const siblings = layerSiblings(nodes, layer);
  const index = siblings?.findIndex((node) => node.layer === layer) ?? -1;
  if (!siblings || index < 0 || !siblings[index + direction]) {
    return;
  }
  [siblings[index], siblings[index + direction]] = [siblings[index + direction]!, siblings[index]!];
  applyTreeOrder(service, nodes);
}

export function reorderRootLayers(
  service: LayerService,
  source: LayerInstance,
  target: LayerInstance,
  after: boolean
): void {
  const nodes = layerTree(service.list());
  const from = nodes.findIndex((node) => node.layer === source);
  if (from < 0 || source === target || !nodes.some((node) => node.layer === target)) {
    return;
  }
  const [node] = nodes.splice(from, 1);
  const to = nodes.findIndex((candidate) => candidate.layer === target) + (after ? 1 : 0);
  nodes.splice(to, 0, node!);
  applyTreeOrder(service, nodes);
}

function applyTreeOrder(service: LayerService, nodes: LayerNode[]) {
  const ids: string[] = [];
  function append(list: LayerNode[]) {
    for (const node of [...list].reverse()) {
      append(node.children);
      ids.push(node.layer.id);
    }
  }
  append(nodes);
  service.setOrder(ids);
}
