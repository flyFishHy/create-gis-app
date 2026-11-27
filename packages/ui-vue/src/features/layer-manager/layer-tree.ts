import type { LayerInstance, LayerService, LayerTreeItem } from '@joinmap/gis-core';

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
export function layerTree(service: LayerService): LayerNode[] {
  const build = (items: readonly LayerTreeItem[]): LayerNode[] =>
    [...items].reverse().map((item) => ({
      layer: service.get(item.id)!,
      children: build(item.children),
    }));
  return build(service.getTree());
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
  const nodes = layerTree(service);
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
  const nodes = layerTree(service);
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
