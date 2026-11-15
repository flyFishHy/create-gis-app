<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { LayerInstance } from '@joinmap/gis-core'
import { useAppState } from '../use-app-state.js'
import { useGISUI } from '../use-gis-ui.js'
import Legend from '../components/Legend.vue'
import SvgIcon from '../components/SvgIcon.vue'
import LayerEditor from './LayerEditor.vue'
import { useGISApp } from '../use-gis-app.js'
const snapshot = useAppState()
const ui = useGISUI()
const app = useGISApp()
const editing = shallowRef<LayerInstance>()
const layers = computed(() => snapshot.value.layers.filter(layer => layer.visible && layer.legend))
const definitions = computed(() => layers.value.flatMap(layer => layer.legend ? [layer.legend] : []))
const titles = computed(() => Object.fromEntries(layers.value.map(layer => [layer.id, layer.title ?? layer.legend?.title ?? layer.id])))
</script>
<template>
  <LayerEditor v-if="editing" :layer="editing" @close="editing = undefined" />
  <Legend v-else :definitions="definitions" :titles="titles" :empty-text="ui.locale.t('legend.empty')">
    <template #group-actions="{ layerId }"><button type="button" class="gis-ui-icon-button gis-ui-legend-edit" :aria-label="`${ui.locale.t('layer.editStyle')} ${titles[layerId]}`" :title="ui.locale.t('layer.editStyle')" @click="editing = app.layers.get(layerId)"><SvgIcon name="edit" :size="15" /></button></template>
  </Legend>
</template>
