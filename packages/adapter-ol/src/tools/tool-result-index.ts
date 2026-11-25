import type Feature from 'ol/Feature.js';
import type GeoJSON from 'ol/format/GeoJSON.js';
import type { WritableVectorTarget } from '../layers/common/layer-binding.js';
import { olTools, type OLToolResult } from './tool-definitions.js';

export interface ToolResultEntry {
  target: WritableVectorTarget;
  feature: Feature;
  result: OLToolResult;
}

export function createToolResultIndex(
  format: GeoJSON,
  callbacks: {
    updated(entry: ToolResultEntry, changedFeature: boolean): void;
    removed(id: string): void;
    changed(): void;
  }
) {
  const results = new Map<string, ToolResultEntry>();

  function remove(id: string) {
    results.delete(id);
    callbacks.removed(id);
  }

  function sync(target: WritableVectorTarget, projection: string) {
    const present = new Set<string>();
    for (const feature of target.source.getFeatures()) {
      const toolId = feature.get('gisToolId') as string | undefined;
      const tool = olTools.find((item) => item.id === toolId);
      const id = feature.getId();
      const geometry = feature.getGeometry();
      if (typeof id !== 'string' || !tool || !geometry || geometry.getType() !== tool.type) {
        continue;
      }
      const old = results.get(id);
      if (old && old.target.layer !== target.layer) {
        continue;
      }
      present.add(id);
      const value = feature.get('value') as OLToolResult['value'];
      const unit = feature.get('unit') as OLToolResult['unit'];
      const result: OLToolResult = {
        id,
        toolId: tool.id,
        projection,
        geometry: format.writeGeometryObject(geometry) as unknown as Record<string, unknown>,
        ...(value === undefined ? {} : { value, unit }),
      };
      const entry = { target, feature, result };
      results.set(id, entry);
      callbacks.updated(entry, old?.feature !== feature);
    }
    for (const [id, entry] of results) {
      if (entry.target.layer === target.layer && !present.has(id)) {
        remove(id);
      }
    }
    callbacks.changed();
  }

  function removeTarget(target: WritableVectorTarget): void {
    for (const [id, entry] of results) {
      if (entry.target === target) {
        remove(id);
      }
    }
    callbacks.changed();
  }

  return {
    get: (id: string) => results.get(id),
    has: (id: string) => results.has(id),
    values: () => results.values(),
    sync,
    removeTarget,
    clear: () => results.clear(),
  };
}
