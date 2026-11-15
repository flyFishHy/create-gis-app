<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import type { LayerInstance, LayerLegend, LayerStyle } from '@joinmap/gis-core'
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
const closed = ref(new Set<LayerInstance>())
const error = ref('')
const originals = new WeakMap<LayerInstance, { legend: LayerLegend; style?: LayerStyle }>()
const layers = computed(() => snapshot.value.layers.filter(layer => layer.visible && layer.legend).flatMap(state => {
  const instance = app.layers.get(state.id)
  if (!instance || closed.value.has(instance)) return []
  if (!originals.has(instance)) originals.set(instance, JSON.parse(JSON.stringify({ legend: instance.legend, style: instance.style })))
  return [{ state, instance }]
}))
const types = computed(() => Object.fromEntries(['category', 'interval', 'continuous', 'image'].map(type => [type, ui.locale.t('editor.' + type)])))
function symbol(layer: LayerInstance) {
  const type = String(layer.getMetadata().geometryType)
  return /LineString$/.test(type) ? 'line' : /Point$/.test(type) ? 'circle' : 'fill'
}
async function reset(layer: LayerInstance) {
  const initial = originals.get(layer)
  if (!initial) return
  try { error.value = ''; await app.layers.update(layer.id, { expectedVersion: layer.version, ...initial }) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
}
</script>
<template>
  <div class="gis-ui-legend-cards">
    <p v-if="error" class="gis-ui-error" role="alert">{{ error }}</p>
    <p v-if="!layers.length && !editing" class="gis-ui-empty">{{ ui.locale.t('legend.empty') }}</p>
    <template v-for="{ state, instance } in layers" :key="state.id">
      <LayerEditor v-if="editing?.id === state.id" :layer="editing" @close="editing = undefined" />
      <Legend v-else class="gis-ui-legend-card" :definitions="state.legend ? [state.legend] : []"
        :titles="{ [state.id]: state.title ?? state.id }" :styles="instance.style ? { [state.id]: instance.style } : {}"
        :symbols="{ [state.id]: symbol(instance) }" :type-labels="types" :default-text="ui.locale.t('editor.default')">
        <template #group-actions>
          <div class="gis-ui-legend-card-actions">
            <button type="button" class="gis-ui-icon-button gis-ui-legend-edit" :aria-label="ui.locale.t('layer.editStyle') + ' ' + state.title" :title="ui.locale.t('layer.editStyle')" @click="editing = instance"><SvgIcon name="edit" :size="14" /></button>
            <button type="button" :aria-label="ui.locale.t('editor.reset') + ' ' + state.title" :title="ui.locale.t('editor.reset')" @click="reset(instance)">↺</button>
            <button type="button" :aria-label="ui.locale.t('editor.close') + ' ' + state.title" :title="ui.locale.t('editor.close')" @click="closed.add(instance)">×</button>
          </div>
        </template>
      </Legend>
    </template>
    <LayerEditor v-if="editing && !layers.some(item => item.state.id === editing!.id)" :layer="editing" @close="editing = undefined" />
    <button v-if="closed.size" type="button" class="gis-ui-legend-restore" @click="closed.clear()">{{ ui.locale.t('editor.restore') }}</button>
  </div>
</template>
