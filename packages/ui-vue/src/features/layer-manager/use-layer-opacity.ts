import { computed, onBeforeUnmount, shallowReactive, type Ref } from 'vue';
import type {
  DeepReadonly,
  LayerInstance,
  LayerService,
  LayerStateSnapshot,
} from '@joinmap/gis-core';

export function useLayerOpacity(
  layers: LayerService,
  snapshot: Readonly<Ref<DeepReadonly<readonly LayerStateSnapshot[]>>>,
  report: (cause?: unknown) => void
) {
  const drafts = shallowReactive(new Map<LayerInstance, number>());
  const jobs = new Map<LayerInstance, { next: number | undefined }>();
  const committed = computed(
    () => new Map(snapshot.value.map((layer) => [layer.id, layer.metadata.opacity]))
  );
  onBeforeUnmount(() => {
    jobs.clear();
    drafts.clear();
  });

  function opacity(layer: LayerInstance): number | null | undefined {
    const draft = drafts.get(layer);
    if (draft !== undefined) {
      return draft;
    }
    const values = layers.getLeaves(layer.id).map((leaf) => committed.value.get(leaf.id));
    const first = values[0];
    if (
      typeof first !== 'number' ||
      values.some((value) => typeof value !== 'number' || !Number.isFinite(value))
    ) {
      return undefined;
    }
    return values.every((value) => value === first) ? Math.round(first * 100) : null;
  }

  function changeOpacity(layer: LayerInstance, event: Event) {
    const value = Math.max(0, Math.min(100, Number((event.target as HTMLInputElement).value)));
    if (!Number.isFinite(value) || layers.get(layer.id) !== layer || opacity(layer) === undefined) {
      return;
    }
    drafts.set(layer, value);
    const job = jobs.get(layer);
    if (job) {
      job.next = value;
    } else {
      void flush(layer, { next: value });
    }
  }

  async function flush(layer: LayerInstance, job: { next: number | undefined }) {
    jobs.set(layer, job);
    const active = () => jobs.get(layer) === job && layers.get(layer.id) === layer;
    report();
    try {
      while (job.next !== undefined && active()) {
        const value = job.next / 100;
        job.next = undefined;
        const results = await Promise.allSettled(
          layers.getLeaves(layer.id).map((target) => target.update({ options: { opacity: value } }))
        );
        const failure = results.find((result) => result.status === 'rejected');
        if (failure) {
          throw failure.reason;
        }
      }
    } catch (cause) {
      if (active()) {
        report(cause);
      }
    } finally {
      jobs.delete(layer);
      drafts.delete(layer);
    }
  }

  return {
    opacity,
    changeOpacity,
    supportsOpacity: (layer: LayerInstance) => opacity(layer) !== undefined,
  };
}
