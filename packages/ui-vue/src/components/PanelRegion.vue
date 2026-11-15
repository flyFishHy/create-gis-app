<script setup lang="ts">
import { computed } from 'vue'
import type { PanelPosition } from '@joinmap/gis-core'
import { useGISUI } from '../use-gis-ui.js'
import PanelHost from './PanelHost.vue'

const props = defineProps<{ position: PanelPosition }>()
const ui = useGISUI()
const panelIds = computed(() => ui.panels.list(props.position)
  .filter(panel => panel.id !== 'toolbar' && panel.id !== 'status')
  .map((panel) => panel.id))
</script>

<template>
  <section class="gis-ui-panel-region" :class="`gis-ui-panel-region--${position}`" :aria-label="`${position} panels`">
    <PanelHost v-for="id in panelIds" :key="id" :id="id" />
  </section>
</template>
