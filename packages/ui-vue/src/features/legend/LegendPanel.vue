<script setup lang="ts">
import PanelEmpty from '../../components/PanelEmpty.vue';
import { computed, ref, shallowRef, watch } from 'vue';
import type { LayerInstance, LayerUpdate } from '@joinmap/gis-core';
import { useAppState } from '../../use-app-state.js';
import { useGISUI } from '../../use-gis-ui.js';
import Legend from '../../components/Legend.vue';
import LegendAction from '../../components/LegendAction.vue';
import LayerEditor from './LayerEditor.vue';
import { useGISApp } from '../../use-gis-app.js';
import { usePanelHeader } from '../../use-panel-header.js';
import { layerSymbol } from './layer-symbol.js';
const snapshot = useAppState((state) => state.layers);
const ui = useGISUI();
const app = useGISApp();
const editing = shallowRef<{ layer: LayerInstance; key: number }>();
let editorKey = 0;
const revision = ref(0);
const error = ref('');
const originals = new WeakMap<LayerInstance, Pick<LayerUpdate, 'legend' | 'style'>>();
const layers = computed(() => {
  void revision.value;
  return snapshot.value
    .filter((layer) => layer.visible)
    .flatMap((state) => {
      const instance = app.layers.get(state.id);
      if (!instance || (!state.legend && !instance.getFields().length)) {
        return [];
      }
      return [{ state, instance }];
    });
});
watch(
  layers,
  (rows) => {
    // Until Core exposes creation-time styles, reset restores the first state seen by this panel.
    for (const { state, instance } of rows) {
      if (!originals.has(instance)) {
        const { layerId: _layerId, type, ...legend } = state.legend ?? { type: undefined };
        originals.set(instance, {
          legend: type ? { ...legend, type } : null,
          style: state.style ?? undefined,
        });
      }
    }
  },
  { immediate: true, flush: 'sync' }
);
const editInList = computed(() =>
  layers.value.some(({ instance }) => instance === editing.value?.layer)
);
function edit(layer: LayerInstance) {
  editing.value = { layer, key: ++editorKey };
}
usePanelHeader(
  computed(() => String(layers.value.filter(({ state }) => state.legend).length)),
  () => {
    error.value = '';
    revision.value++;
  }
);
const types = computed(() =>
  Object.fromEntries(
    ['category', 'interval', 'continuous', 'image'].map((type) => [
      type,
      ui.locale.t('editor.' + type),
    ])
  )
);
async function reset(layer: LayerInstance) {
  const initial = originals.get(layer);
  if (!initial || app.layers.get(layer.id) !== layer) {
    return;
  }
  try {
    error.value = '';
    await layer.update({ expectedVersion: layer.version, ...initial });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}
function filter(layer: LayerInstance, id: string) {
  try {
    error.value = '';
    layer.setLegendFilter(layer.getLegendFilter() === id ? undefined : id);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
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
      <LayerEditor
        v-if="editing?.layer === instance"
        :key="editing.key"
        :layer="editing.layer"
        @close="editing = undefined"
      />
      <Legend
        v-else-if="state.legend"
        class="gis-ui-legend-card"
        :definitions="[state.legend]"
        :titles="{ [state.id]: state.title ?? state.id }"
        :styles="state.style ? { [state.id]: state.style } : {}"
        :filterable="instance.supportsLegendFilter()"
        :active-rule="instance.getLegendFilter()"
        @filter="filter(instance, $event)"
        :symbols="{ [state.id]: layerSymbol(state.metadata.geometryType) }"
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
              @click="edit(instance)"
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
          @click="edit(instance)"
        />
      </section>
    </template>
    <LayerEditor
      v-if="editing && !editInList"
      :key="editing.key"
      :layer="editing.layer"
      @close="editing = undefined"
    />
  </div>
</template>
