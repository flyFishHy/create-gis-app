import type { MapLayerHandle } from '@joinmap/gis-core';
import type OlMap from 'ol/Map.js';
import type { LayerBinding, WritableVectorTarget } from '../layers/common/layer-binding.js';

export class OLLayerCollection {
  private readonly bindings = new WeakMap<MapLayerHandle, LayerBinding>();
  private readonly attached = new Map<string, LayerBinding>();

  constructor(private readonly getMap: () => OlMap) {}

  addLayer(handle: MapLayerHandle, index?: number): void {
    const binding = this.requireBinding(handle);
    const layer = binding.layer;
    const collection = this.getMap().getLayers();
    if (index === undefined || index >= collection.getLength()) {
      collection.push(layer);
    } else {
      collection.insertAt(Math.max(index, 0), layer);
    }
    this.attached.set(binding.id, binding);
  }

  removeLayer(handle: MapLayerHandle): void {
    const binding = this.bindings.get(handle);
    if (!binding) {
      return;
    }
    this.getMap().removeLayer(binding.layer);
    if (this.attached.get(binding.id) === binding) {
      this.attached.delete(binding.id);
    }
    this.bindings.delete(handle);
  }

  setLayerOrder(handles: readonly MapLayerHandle[]): void {
    const layers = handles.map((handle) => this.requireBinding(handle).layer);
    const collection = this.getMap().getLayers();
    const managed = new Set(layers);
    const positions = collection
      .getArray()
      .flatMap((layer, index) => (managed.has(layer) ? [index] : []));
    for (const layer of layers) {
      collection.remove(layer);
    }
    layers.forEach((layer, index) =>
      collection.insertAt(positions[index] ?? collection.getLength(), layer)
    );
  }

  clearAttached(): void {
    this.attached.clear();
  }

  trackLayer(binding: LayerBinding): MapLayerHandle {
    this.bindings.set(binding.handle, binding);
    return binding.handle;
  }

  getWritableTarget(id: string): WritableVectorTarget | undefined {
    return this.attached.get(id)?.writableTarget;
  }

  private requireBinding(handle: MapLayerHandle): LayerBinding {
    const binding = this.bindings.get(handle);
    if (!binding) {
      throw new Error('Layer handle was not created by this OpenLayers Adapter.');
    }
    return binding;
  }
}
