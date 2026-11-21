<script setup lang="ts">
import PanelEmpty from '../components/PanelEmpty.vue'
import { computed } from 'vue'
import { useAppState } from '../use-app-state.js'
import { useGISUI } from '../use-gis-ui.js'
import FeatureDetails from '../components/FeatureDetails.vue'
import SvgIcon from '../components/SvgIcon.vue'
const selection = useAppState(state => state.interactions.selection)
const layers = useAppState(state => state.layers)
const ui = useGISUI()
const layerTitle = computed(() => {
  const feature = selection.value
  return layers.value.find(layer => layer.id === feature?.layerId)?.title || feature?.layerId
})
</script>

<template>
  <div class="gis-properties">
    <h3 v-if="selection" class="gis-ui-properties-layer-title"><SvgIcon name="layers" :size="16" /><span>{{ layerTitle }}</span></h3>
    <FeatureDetails v-if="selection" :feature="selection" />
    <PanelEmpty v-else icon="mouse-pointer-click" :title="ui.locale.t('properties.emptyTitle')" :description="ui.locale.t('properties.empty')" />
  </div>
</template>
