<script lang="ts">
import type { GISApp } from '@joinmap/gis-core';

// Keep the last displayed position across status-panel remounts without retaining the app.
const lastPointerByApp = new WeakMap<GISApp, readonly [number, number]>();
</script>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { useAppState } from '../use-app-state.js';
import { useGISUI } from '../use-gis-ui.js';
import { useGISApp } from '../use-gis-app.js';
import SvgIcon from '../components/SvgIcon.vue';

const props = defineProps<{ coordinate?: readonly [number, number]; scale?: string }>();
const snapshot = useAppState();
const ui = useGISUI();
const app = useGISApp();
const pointer = ref<readonly [number, number] | undefined>(lastPointerByApp.get(app));
let stopPointer: (() => void) | undefined;
onMounted(() => {
  stopPointer = app.map.onPointerMove((value) => {
    if (value && value.every(Number.isFinite)) {
      pointer.value = [value[0], value[1]];
      lastPointerByApp.set(app, pointer.value);
    }
  });
});
onBeforeUnmount(() => stopPointer?.());
const coordinate = computed(() => props.coordinate ?? pointer.value);
const coordinateText = computed(() =>
  coordinate.value ? `${coordinate.value[0].toFixed(5)},${coordinate.value[1].toFixed(5)}` : '--'
);
const scale = computed(() => {
  if (props.scale !== undefined) {
    return props.scale;
  }
  const meters = snapshot.value.map.metersPerPixel;
  return meters !== null && meters > 0
    ? `1:${Math.round(meters / 0.00028).toLocaleString(ui.locale.get() === 'zh' ? 'zh-CN' : 'en-US')}`
    : undefined;
});
const level = computed(() => {
  const zoom = snapshot.value.map.zoom;
  return zoom === null ? '—' : Number(zoom.toFixed(2)).toString();
});
</script>

<template>
  <div class="gis-ui-map-status-panel" aria-label="Map status">
    <div class="gis-ui-status-details">
      <div
        class="gis-ui-status-cell gis-ui-status-level"
        :title="`${ui.locale.t('status.level')}: ${level}`"
      >
        <span class="gis-ui-status-label"
          ><SvgIcon
            class="gis-ui-status-icon"
            name="scan"
            :size="14"
            :title="ui.locale.t('status.level')"
          /><span class="gis-ui-status-text">{{ ui.locale.t('status.level') }}</span></span
        ><output aria-label="Map level">{{ level }}</output>
      </div>
      <div
        class="gis-ui-status-cell gis-ui-status-scale"
        :title="`${ui.locale.t('status.scale')}: ${scale || '—'}`"
      >
        <span class="gis-ui-status-label"
          ><SvgIcon
            class="gis-ui-status-icon"
            name="scale"
            :size="14"
            :title="ui.locale.t('status.scale')"
          /><span class="gis-ui-status-text">{{ ui.locale.t('status.scale') }}</span></span
        ><output>{{ scale || '—' }}</output>
      </div>
      <div
        class="gis-ui-status-cell gis-ui-status-projection"
        :title="`${ui.locale.t('status.projection')}: ${snapshot.map.projection || '—'}`"
      >
        <span class="gis-ui-status-label"
          ><SvgIcon
            class="gis-ui-status-icon"
            name="global"
            :size="14"
            :title="ui.locale.t('status.projection')"
          /><span class="gis-ui-status-text">{{ ui.locale.t('status.projection') }}</span></span
        ><output>{{ snapshot.map.projection || '—' }}</output>
      </div>
    </div>
    <div
      class="gis-ui-status-cell gis-ui-status-coordinates"
      :title="
        coordinate
          ? `${ui.locale.t('status.coordinates')}: ${coordinateText}`
          : ui.locale.t('status.movePointer')
      "
    >
      <span class="gis-ui-status-label"
        ><SvgIcon
          class="gis-ui-status-icon"
          name="location"
          :size="14"
          :title="ui.locale.t('status.coordinates')"
        /><span class="gis-ui-status-text">{{ ui.locale.t('status.coordinates') }}</span></span
      >
      <output aria-live="off" :aria-label="ui.locale.t('status.coordinates')">{{
        coordinateText
      }}</output>
    </div>
  </div>
</template>
