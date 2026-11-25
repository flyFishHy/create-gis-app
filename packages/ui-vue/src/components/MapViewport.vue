<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useGISApp } from '../use-gis-app.js';

const app = useGISApp();

const target = ref<HTMLElement>();

onMounted(() => {
  if (app.map.isReady && target.value) {
    app.map.setTarget(target.value);
  }
});

onBeforeUnmount(() => {
  if (app.map.isReady) {
    app.map.setTarget(undefined);
  }
});
</script>

<template>
  <div ref="target" class="gis-ui-map-viewport" tabindex="0" aria-label="GIS map" />
</template>
