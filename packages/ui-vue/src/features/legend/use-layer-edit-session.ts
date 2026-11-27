import { computed, onBeforeUnmount, ref, shallowRef } from 'vue';
import type { LayerInstance } from '@joinmap/gis-core';
import type { LegendEditValue } from '../../components/legend-editor-types.js';
import { useAppState } from '../../use-app-state.js';
import { useGISApp } from '../../use-gis-app.js';

export function useLayerEditSession(layer: LayerInstance, complete: () => void) {
  const { layers } = useGISApp();
  const current = useAppState((state) => state.layers.find((entry) => entry.id === layer.id));
  const saving = ref(false);
  const error = ref('');
  const editorKey = ref(0);
  let stopped = false;
  onBeforeUnmount(() => {
    stopped = true;
  });

  function read() {
    const { layerId: _layerId, type, ...legend } = layer.legend ?? { type: undefined };
    const style = layer.style;
    return {
      legend: type ? { ...legend, type } : undefined,
      style:
        style &&
        typeof style.fillColor === 'string' &&
        typeof style.strokeColor === 'string' &&
        typeof style.strokeWidth === 'number' &&
        typeof style.pointRadius === 'number'
          ? {
              ...style,
              fillColor: style.fillColor,
              strokeColor: style.strokeColor,
              strokeWidth: style.strokeWidth,
              pointRadius: style.pointRadius,
            }
          : undefined,
      version: layer.version,
    };
  }
  const base = shallowRef(read());
  const isCurrent = () => layers.get(layer.id) === layer && layer.status === 'ready';
  const alive = computed(() => current.value?.status === 'ready' && isCurrent());
  const conflict = computed(() => alive.value && current.value?.version !== base.value.version);

  function reload() {
    base.value = read();
    editorKey.value++;
    error.value = '';
  }

  async function submit(value: LegendEditValue) {
    if (saving.value || !isCurrent() || conflict.value) {
      return;
    }
    saving.value = true;
    error.value = '';
    try {
      await layer.update({
        expectedVersion: base.value.version,
        legend: value.legend,
        ...(value.style ? { style: { ...value.style } } : {}),
      });
      if (!stopped && isCurrent()) {
        complete();
      }
    } catch (cause) {
      if (!stopped && isCurrent()) {
        error.value = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      if (!stopped) {
        saving.value = false;
      }
    }
  }
  return { alive, conflict, base, saving, error, editorKey, reload, submit };
}
