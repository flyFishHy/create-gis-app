<script setup lang="ts">
import PanelEmpty from '../components/PanelEmpty.vue'
import { computed, ref, shallowRef } from 'vue'
import type { LayerInstance, LayerLegend, LayerStyle } from '@joinmap/gis-core'
import { useAppState } from '../use-app-state.js'
import { useGISUI } from '../use-gis-ui.js'
import Legend from '../components/Legend.vue'
import LegendAction from '../components/LegendAction.vue'
import LayerEditor from './LayerEditor.vue'
import { useGISApp } from '../use-gis-app.js'
import { usePanelHeader } from '../use-panel-header.js'
const snapshot = useAppState((state) => state.layers)
const ui = useGISUI()
const app = useGISApp()
const editing = shallowRef<LayerInstance>()
const revision = ref(0)
const error = ref('')
const originals = new WeakMap<LayerInstance, { legend: LayerLegend | null; style?: LayerStyle }>()
const layers = computed(() => {
  void revision.value
  return snapshot.value
    .filter((layer) => layer.visible)
    .flatMap((state) => {
      const instance = app.layers.get(state.id)
      if (!instance || (!state.legend && !instance.getFields().length)) return []
      if (!originals.has(instance))
        originals.set(
          instance,
          JSON.parse(JSON.stringify({ legend: instance.legend ?? null, style: instance.style }))
        )
      return [{ state, instance }]
    })
})
usePanelHeader(
  computed(() => String(layers.value.filter(({ state }) => state.legend).length)),
  () => {
    error.value = ''
    revision.value++
  }
)
const types = computed(() =>
  Object.fromEntries(
    ['category', 'interval', 'continuous', 'image'].map((type) => [
      type,
      ui.locale.t('editor.' + type),
    ])
  )
)
function symbol(layer: LayerInstance) {
  const type = String(layer.getMetadata().geometryType)
  return /LineString$/.test(type) ? 'line' : /Point$/.test(type) ? 'circle' : 'fill'
}
async function reset(layer: LayerInstance) {
  const initial = originals.get(layer)
  if (!initial) return
  try {
    error.value = ''
    await app.layers.update(layer.id, { expectedVersion: layer.version, ...initial })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
function filter(layer: LayerInstance, id: string) {
  try {
    error.value = ''
    layer.setLegendFilter(layer.getLegendFilter() === id ? undefined : id)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
</script>
<template>
  <div class="gis-ui-legend-cards">
    <p v-if="error" class="gis-ui-error" role="alert">{{ error }}</p>
    <PanelEmpty
      v-if="!layers.length && !editing"
      icon="legend"
      :title="ui.locale.t('legend.empty')"
      :description="ui.locale.t('legend.emptyDescription')"
    />
    <template v-for="{ state, instance } in layers" :key="state.id">
      <LayerEditor v-if="editing?.id === state.id" :layer="editing" @close="editing = undefined" />
      <Legend
        v-else-if="state.legend"
        class="gis-ui-legend-card"
        :definitions="[state.legend]"
        :titles="{ [state.id]: state.title ?? state.id }"
        :styles="instance.style ? { [state.id]: instance.style } : {}"
        :filterable="instance.supportsLegendFilter()"
        :active-rule="instance.getLegendFilter()"
        @filter="filter(instance, $event)"
        :symbols="{ [state.id]: symbol(instance) }"
        :type-labels="types"
        :default-text="ui.locale.t('editor.default')"
        :layer-color-text="ui.locale.t('editor.layerColor')"
      >
        <template #group-actions>
          <div class="gis-ui-legend-card-actions">
            <LegendAction
              class="gis-ui-legend-edit"
              icon="edit"
              :label="ui.locale.t('layer.editStyle') + ' ' + state.title"
              @click="editing = instance"
            />
            <LegendAction
              icon="reset"
              :label="ui.locale.t('editor.reset') + ' ' + state.title"
              @click="reset(instance)"
            />
          </div>
        </template>
      </Legend>
      <section v-else class="gis-ui-legend-card gis-ui-legend-heading">
        <h3>{{ state.title ?? state.id }}</h3>
        <LegendAction
          class="gis-ui-legend-edit"
          icon="plus"
          :label="ui.locale.t('editor.create') + ' ' + (state.title ?? state.id)"
          @click="editing = instance"
        />
      </section>
    </template>
    <LayerEditor
      v-if="editing && !layers.some((item) => item.state.id === editing!.id)"
      :layer="editing"
      @close="editing = undefined"
    />
  </div>
</template>
