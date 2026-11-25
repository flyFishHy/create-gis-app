import type { FeatureRendererDefinition, FeatureRendererService } from '../types.js';
import type { FeatureReference } from '@joinmap/gis-core';

export class FeatureRendererServiceImpl implements FeatureRendererService {
  private readonly definitions = new Map<string, FeatureRendererDefinition>();

  register(definition: FeatureRendererDefinition): () => void {
    if (!definition.id.trim()) {
      throw new Error('Feature renderer id must be a non-empty string.');
    }
    if (this.definitions.has(definition.id)) {
      throw new Error(`Feature renderer "${definition.id}" is already registered.`);
    }
    this.definitions.set(definition.id, Object.freeze({ ...definition }));
    let registered = true;
    return () => {
      if (!registered) {
        return;
      }
      registered = false;
      this.definitions.delete(definition.id);
    };
  }

  resolve(feature: FeatureReference): FeatureRendererDefinition | undefined {
    return [...this.definitions.values()]
      .filter((definition) => definition.match(feature))
      .sort(
        (leftRenderer, rightRenderer) =>
          (rightRenderer.priority ?? 0) - (leftRenderer.priority ?? 0) ||
          leftRenderer.id.localeCompare(rightRenderer.id)
      )[0];
  }

  clear(): void {
    this.definitions.clear();
  }
}
