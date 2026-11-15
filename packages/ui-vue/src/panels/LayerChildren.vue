<script setup lang="ts">
import type { LayerInstance } from '@joinmap/gis-core'
import type { LayerNode } from './layer-tree.js'
import { useGISUI } from '../use-gis-ui.js'
import SvgIcon from '../components/SvgIcon.vue'

defineProps<{ nodes: readonly LayerNode[] }>()
const emit = defineEmits<{ toggle: [layer: LayerInstance] }>()
const ui = useGISUI()
</script>

<template>
  <ul class="gis-ui-layer-children">
    <li v-for="node in nodes" :key="node.layer.id" class="gis-ui-layer-child">
      <div class="gis-ui-layer-child-heading">
        <button type="button" class="gis-ui-layer-visibility"
          :aria-label="`${ui.locale.t('action.toggleLayer')} ${node.layer.title || node.layer.id}`"
          :aria-pressed="node.layer.visible" @click="emit('toggle', node.layer)">
          <SvgIcon :name="node.layer.visible ? 'eye' : 'eye-off'" :size="16" />
        </button>
        <span class="gis-ui-layer-name" :title="node.layer.title || node.layer.id">{{ node.layer.title || node.layer.id }}</span>
      </div>
      <LayerChildren v-if="node.children.length" :nodes="node.children" @toggle="emit('toggle', $event)" />
    </li>
  </ul>
</template>
