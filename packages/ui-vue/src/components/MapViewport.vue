<script lang="ts">
import type { GISApp } from '@joinmap/gis-core';

const mapTargets = new WeakMap<GISApp, HTMLElement>();
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useGISApp } from '../use-gis-app.js';

const app = useGISApp();

const target = ref<HTMLElement>();

onMounted(() => {
  if (app.map.isReady && target.value) {
    app.map.setTarget(target.value);
    mapTargets.set(app, target.value);
  }
});

onBeforeUnmount(() => {
  if (!target.value || mapTargets.get(app) !== target.value) {
    return;
  }
  mapTargets.delete(app);
  if (app.map.isReady) {
    app.map.setTarget(undefined);
  }
});
</script>

<template>
  <div ref="target" class="gis-ui-map-viewport" tabindex="0" aria-label="GIS map" />
</template>
