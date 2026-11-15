<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import type { LayerInstance } from '@joinmap/gis-core'
import { useGISApp } from '../use-gis-app.js'
import { useGISUI } from '../use-gis-ui.js'
import SvgIcon from '../components/SvgIcon.vue'

interface LayerNode {
  layer: LayerInstance
  depth: number
  group: boolean
}

const app = useGISApp()
const ui = useGISUI()
const revision = shallowRef(0)
const collapsedGroups = shallowRef(new Set<string>())
const error = shallowRef<string>()
let unsubscribe: (() => void) | undefined

onMounted(() => {
  unsubscribe = app.layers.subscribe(() => { revision.value += 1 })
})
onBeforeUnmount(() => unsubscribe?.())

const rows = computed(() => {
  void revision.value
  const instances = app.layers.list()
  const byId = new Map(instances.map((layer) => [layer.id, layer]))
  const childIds = new Set<string>()
  for (const layer of instances) {
    if (layer.type === 'GROUP') {
      for (const id of childIdsOf(layer)) childIds.add(id)
    }
  }
  const result: LayerNode[] = []
  const append = (layer: LayerInstance, depth: number) => {
    const group = layer.type === 'GROUP'
    result.push({ layer, depth, group })
    if (!group || collapsedGroups.value.has(layer.id)) return
    for (const id of childIdsOf(layer)) {
      const child = byId.get(id)
      if (child) append(child, depth + 1)
    }
  }
  for (const layer of instances) if (!childIds.has(layer.id)) append(layer, 0)
  return result
})

function childIdsOf(layer: LayerInstance): string[] {
  const childIds = layer.getMetadata().childIds
  return Array.isArray(childIds) ? childIds.filter((id): id is string => typeof id === 'string') : []
}

function toggleVisibility(layer: LayerInstance) {
  try {
    error.value = undefined
    app.layers.setVisibility(layer.id, !layer.visible)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function removeLayer(layer: LayerInstance) {
  try {
    error.value = undefined
    await app.layers.remove(layer.id)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

function toggleGroup(id: string) {
  const next = new Set(collapsedGroups.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsedGroups.value = next
}

</script>

<template>
  <div class="gis-ui-layer-manager">
    <p v-if="error" class="gis-ui-error" role="alert">{{ error }}</p>
    <p v-if="rows.length === 0" class="gis-ui-empty">{{ ui.locale.t('layer.empty') }}</p>
    <ul v-else class="gis-ui-layer-list">
      <li v-for="row in rows" :key="row.layer.id" class="gis-ui-layer-row" :style="{ paddingLeft: `${row.depth * 16 + 8}px` }">
        <button
          v-if="row.group"
          type="button"
          class="gis-ui-icon-button"
          :aria-label="ui.locale.t(collapsedGroups.has(row.layer.id) ? 'action.expand' : 'action.collapse')"
          @click="toggleGroup(row.layer.id)"
        >{{ collapsedGroups.has(row.layer.id) ? '▸' : '▾' }}</button>
        <span v-else class="gis-ui-layer-indent" />
        <button type="button" class="gis-ui-layer-visibility" :aria-label="`${ui.locale.t('action.toggleLayer')} ${row.layer.title ?? row.layer.id}`" :aria-pressed="row.layer.visible" @click="toggleVisibility(row.layer)">
          <SvgIcon :name="row.layer.visible ? 'eye' : 'eye-off'" :size="16" />
        </button>
        <span class="gis-ui-layer-name" :title="row.layer.title ?? row.layer.id">{{ row.layer.title ?? row.layer.id }}</span>
        <small>{{ row.layer.status }}</small>
        <button type="button" class="gis-ui-icon-button" :aria-label="`${ui.locale.t('action.removeLayer')} ${row.layer.title ?? row.layer.id}`" @click="removeLayer(row.layer)">×</button>
      </li>
    </ul>
  </div>
</template>
