<script setup lang="ts">
import { useAppState } from '../use-app-state.js'
import { useGISUI } from '../use-gis-ui.js'
import FeatureDetails from '../components/FeatureDetails.vue'
const snapshot = useAppState()
const ui = useGISUI()
</script>

<template>
  <div class="gis-properties">
    <FeatureDetails v-if="snapshot.interactions.selection" :feature="snapshot.interactions.selection" />
    <p v-else class="gis-ui-empty">{{ ui.locale.t('properties.empty') }}</p>
  </div>
</template>
