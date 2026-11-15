<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { LayerInstance, LayerLegend } from '@joinmap/gis-core'
import { useGISApp } from '../use-gis-app.js'
import { useGISUI } from '../use-gis-ui.js'
import { useAppState } from '../use-app-state.js'
import LegendEditor from '../components/LegendEditor.vue'
import type { LegendEditValue, UniformLayerStyle } from '../components/legend-editor-types.js'

const props = defineProps<{ layer: LayerInstance }>()
const emit = defineEmits<{ close: [] }>()
const app = useGISApp(), ui = useGISUI(), snapshot = useAppState()
const saving = ref(false), error = ref(''), editorKey = ref(0)
let stopped = false
onBeforeUnmount(() => { stopped = true })
function read() {
  const resolved = props.layer.legend
  const legend: LayerLegend | undefined = resolved ? (({ layerId: _layerId, ...rest }) => JSON.parse(JSON.stringify(rest)))(resolved) : undefined
  const value = props.layer.getMetadata().style as Partial<UniformLayerStyle> | undefined
  const style = value && typeof value.fillColor === 'string' && typeof value.strokeColor === 'string' && typeof value.strokeWidth === 'number' && typeof value.pointRadius === 'number'
    ? { fillColor: value.fillColor, strokeColor: value.strokeColor, strokeWidth: value.strokeWidth, pointRadius: value.pointRadius } : undefined
  return { legend, style, version: props.layer.version }
}
const base = shallowRef(read())
const alive = computed(() => { void snapshot.value; return app.layers.get(props.layer.id) === props.layer && props.layer.status !== 'disposed' })
const conflict = computed(() => { void snapshot.value; return alive.value && JSON.stringify(read()) !== JSON.stringify(base.value) })
const keys = ['style', 'fillColor', 'strokeColor', 'strokeWidth', 'pointRadius', 'enabled', 'title', 'item', 'color', 'follow', 'presentation', 'image', 'apply', 'cancel', 'invalid', 'up', 'down', 'noData']
const labels = computed(() => Object.fromEntries(keys.map(key => [key, ui.locale.t(`editor.${key}`)])))
function reload() { base.value = read(); editorKey.value++; error.value = '' }
async function submit(value: LegendEditValue) {
  if (saving.value || !alive.value || conflict.value) return
  saving.value = true; error.value = ''
  try {
    await app.layers.update(props.layer.id, { expectedVersion: base.value.version, legend: value.legend, ...(value.style ? { options: { style: { ...value.style } } } : {}) })
    if (!stopped) emit('close')
  } catch (cause) {
    if (!stopped) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally { if (!stopped) saving.value = false }
}
</script>

<template>
  <div class="gis-ui-layer-editor">
    <div class="gis-ui-layer-editor-heading"><strong>{{ layer.title || layer.id }}</strong><button type="button" :disabled="saving" @click="emit('close')">{{ ui.locale.t('editor.back') }}</button></div>
    <p v-if="!alive" class="gis-ui-error" role="alert">{{ ui.locale.t('editor.removed') }}</p>
    <template v-else>
      <div v-if="conflict && !saving" class="gis-ui-editor-conflict" role="alert">{{ ui.locale.t('editor.conflict') }}<button type="button" @click="reload">{{ ui.locale.t('editor.reload') }}</button></div>
      <LegendEditor :key="editorKey" :legend="base.legend" :layer-style="base.style" :title="layer.title || layer.id"
        :labels="labels" :saving="saving || conflict" :error="error" @submit="submit" @cancel="emit('close')" />
    </template>
  </div>
</template>
