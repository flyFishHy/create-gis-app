<script setup lang="ts">
import { computed } from 'vue';
import type { PanelPosition } from '@joinmap/gis-core';
import { useGISUI } from '../use-gis-ui.js';
import { panelSlot } from '../layouts/layout-regions.js';
import PanelHost from './PanelHost.vue';

const props = defineProps<{
  position: PanelPosition;
  exclude?: readonly string[];
  panelIds?: readonly string[];
}>();
const ui = useGISUI();
const ids = computed(() => {
  const position = props.position;
  const panels =
    props.panelIds ??
    ui.panels
      .list(position)
      .filter((panel) => panelSlot(panel, position) === position)
      .map((panel) => panel.id);
  return panels.filter((id) => !props.exclude?.includes(id));
});
</script>

<template>
  <section
    class="gis-ui-panel-region"
    :class="`gis-ui-panel-region--${position}`"
    :aria-label="`${position} panels`"
  >
    <PanelHost v-for="id in ids" :key="id" :id="id" />
  </section>
</template>
