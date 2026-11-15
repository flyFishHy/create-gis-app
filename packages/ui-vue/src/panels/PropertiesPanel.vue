<script setup lang="ts">
import { computed } from 'vue'
import { useAppState } from '../use-app-state.js'
import { useGISUI } from '../use-gis-ui.js'
import FeatureDetails from '../components/FeatureDetails.vue'
import SvgIcon from '../components/SvgIcon.vue'
const snapshot = useAppState()
const ui = useGISUI()
const layerTitle = computed(() => {
  const feature = snapshot.value.interactions.selection
  return snapshot.value.layers.find(layer => layer.id === feature?.layerId)?.title || feature?.layerId
})
</script>

<template>
  <div class="gis-properties">
    <h3 v-if="snapshot.interactions.selection" class="gis-ui-properties-layer-title"><SvgIcon name="layers" :size="16" /><span>{{ layerTitle }}</span></h3>
    <FeatureDetails v-if="snapshot.interactions.selection" :feature="snapshot.interactions.selection" />
    <p v-else class="gis-ui-empty">{{ ui.locale.t('properties.empty') }}</p>
  </div>
</template>
