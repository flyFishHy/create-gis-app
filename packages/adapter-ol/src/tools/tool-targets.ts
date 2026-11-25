import type { GISApp, JsonValue, LayerConfig, LayerInstance } from '@joinmap/gis-core';
import { GISRuntimeError } from '@joinmap/gis-core';
import type { WritableVectorTarget } from '../layers/common/layer-binding.js';

const defaults = {
  'draw-point': '绘制点',
  'draw-line': '绘制线',
  'draw-polygon': '绘制面',
  'measure-distance': '距离测量',
  'measure-area': '面积测量',
  'measure-angle': '角度测量',
} as const;

export type ToolId = keyof typeof defaults;

export function toolTargets(
  app: GISApp,
  getWritableTarget: (id: string) => WritableVectorTarget | undefined
) {
  const configured = () => ({
    'draw-point': app.config?.tools?.draw?.targets?.point,
    'draw-line': app.config?.tools?.draw?.targets?.line,
    'draw-polygon': app.config?.tools?.draw?.targets?.polygon,
    'measure-distance': app.config?.tools?.measure?.targets?.distance,
    'measure-area': app.config?.tools?.measure?.targets?.area,
    'measure-angle': undefined,
  });
  const created = new Map<string, LayerInstance>();
  let pending: Promise<unknown> = Promise.resolve();
  const idFor = (tool: ToolId) => `ol-tools:${tool}`;
  const configFor = (tool: ToolId, zIndex: number, firstFeature?: JsonValue): LayerConfig => ({
    id: idFor(tool),
    type: 'geojson',
    title: defaults[tool],
    zIndex,
    source: {
      type: 'inline',
      data: {
        type: 'FeatureCollection',
        features: firstFeature === undefined ? [] : [firstFeature],
      },
    },
  });
  const writable = (id: string): WritableVectorTarget | undefined => {
    const target = getWritableTarget(id);
    if (
      target &&
      target.layer.getSource() === target.source &&
      target.data.status === 'ready' &&
      app.data.get(target.data.id) === target.data &&
      app.layers.get(id)?.status === 'ready'
    ) {
      return target;
    }
  };
  const requireWritable = (tool: ToolId, id: string): WritableVectorTarget => {
    const target = writable(id);
    if (!target) {
      throw new GISRuntimeError({
        code: app.layers.has(id) ? 'CONFIG_INVALID' : 'LAYER_NOT_FOUND',
        message: `Tool "${tool}" requires a writable inline GeoJSON layer "${id}".`,
      });
    }
    return target;
  };
  const existing = (tool: ToolId): WritableVectorTarget | undefined => {
    const explicit = configured()[tool];
    if (explicit !== undefined) {
      return requireWritable(tool, explicit);
    }
    const id = idFor(tool);
    if (app.layers.has(id) && app.layers.get(id) === created.get(id)) {
      return requireWritable(tool, id);
    }
  };

  const ownedGroup = (id: string) => {
    const layer = app.layers.get(id);
    return layer?.status === 'ready' && layer === created.get(id) ? layer : undefined;
  };
  const zIndexOf = (layer: LayerInstance) => {
    const zIndex = layer.getMetadata().zIndex;
    return typeof zIndex === 'number' && Number.isFinite(zIndex) ? zIndex : 0;
  };
  const childLayers = (group: LayerInstance | undefined) => {
    const ids = group?.getMetadata().childIds;
    return Array.isArray(ids)
      ? ids.flatMap((id) => {
          const layer = app.layers.get(String(id));
          return layer ? [layer] : [];
        })
      : [];
  };
  const nextZIndex = (drawing: boolean, group: LayerInstance | undefined) => {
    const children = childLayers(group);
    // Append within the group's current stacking position, including after a drag.
    if (children.length) {
      return Math.max(...children.map(zIndexOf));
    }
    const others = app.layers
      .list()
      .filter((layer) => layer.type !== 'GROUP')
      .map(zIndexOf);
    const measurements = drawing ? childLayers(ownedGroup('ol-tools:measure')) : [];
    if (!measurements.length) {
      return Math.max(0, ...others) + 1;
    }
    const ceiling = Math.min(...measurements.map(zIndexOf));
    const below = others.filter((value) => value < ceiling);
    return below.length ? Math.max(...below) / 2 + ceiling / 2 : ceiling - 1;
  };

  return {
    isConfigured: (id: string) => Object.values(configured()).includes(id),
    writable,
    existing,
    async resolve(tool: ToolId, firstFeature?: JsonValue) {
      const current = existing(tool);
      if (current) {
        return { target: current, seeded: false };
      }
      // Serialize first additions so concurrent commits see each other's groups and order.
      const task = pending.then(async () => {
        const ready = existing(tool);
        if (ready) {
          return { target: ready, seeded: false };
        }
        const drawing = tool.startsWith('draw-');
        const groupId = drawing ? 'ol-tools:draw' : 'ol-tools:measure';
        const group = ownedGroup(groupId);
        const child = configFor(tool, nextZIndex(drawing, group), firstFeature);
        if (group) {
          created.set(child.id, await app.layers.addChild(groupId, child));
        } else {
          const parent = await app.layers.add({
            id: groupId,
            type: 'GROUP',
            title: drawing ? '绘制结果' : '测量结果',
            children: [child],
          });
          created.set(groupId, parent);
          const instance = app.layers.get(child.id);
          if (instance) {
            created.set(child.id, instance);
          }
        }
        return { target: requireWritable(tool, child.id), seeded: firstFeature !== undefined };
      });
      pending = task.catch(() => undefined);
      return task;
    },
  };
}
