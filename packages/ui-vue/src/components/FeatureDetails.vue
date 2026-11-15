<script setup lang="ts">
import type { FeatureReference } from '@joinmap/gis-core'
import { useGISUI } from '../use-gis-ui.js'
defineProps<{ feature: FeatureReference }>()
const ui = useGISUI()
</script>

<template>
  <component v-if="ui.featureRenderers.resolve(feature)" :is="ui.featureRenderers.resolve(feature)?.component" :feature="feature" />
  <dl v-else>
    <div><dt>{{ ui.locale.t('properties.layer') }}</dt><dd>{{ feature.layerId }}</dd></div>
    <div v-if="feature.id !== undefined"><dt>{{ ui.locale.t('properties.featureId') }}</dt><dd>{{ feature.id }}</dd></div>
    <div v-if="feature.geometryType"><dt>{{ ui.locale.t('properties.geometry') }}</dt><dd>{{ feature.geometryType }}</dd></div>
    <template v-for="(value, key) in feature.properties" :key="key">
      <div><dt>{{ key }}</dt><dd>{{ typeof value === 'object' ? JSON.stringify(value) : value }}</dd></div>
    </template>
  </dl>
</template>
