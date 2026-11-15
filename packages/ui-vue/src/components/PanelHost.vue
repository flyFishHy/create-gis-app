<script setup lang="ts">
import { computed } from 'vue'
import { useGISUI } from '../use-gis-ui.js'
import PanelShell from './PanelShell.vue'
import { cssSize } from '../panels/panel-size.js'

const props = defineProps<{ id: string }>()
const ui = useGISUI()
const definition = computed(() => ui.panels.get(props.id))
const state = computed(() => ui.panels.getState(props.id))
const displayTitle = computed(() => {
  const title = definition.value?.title
  return title ? ui.locale.t(title) : undefined
})
const panelStyle = computed(() => {
  const current = state.value
  if (!current) return undefined
  return {
    width: current.position === 'left' || current.position === 'right' ? '100%' : cssSize(current.width),
    height: cssSize(current.height),
    flex: current.height === undefined ? undefined : '0 1 auto',
    minWidth: definition.value?.minWidth === undefined ? undefined : `min(100%, ${cssSize(definition.value.minWidth)})`,
    maxWidth: definition.value?.maxWidth === undefined ? undefined : `min(100%, ${cssSize(definition.value.maxWidth)})`,
    minHeight: cssSize(definition.value?.minHeight),
    maxHeight: cssSize(definition.value?.maxHeight),
  }
})
</script>

<template>
  <div v-if="definition && state?.visible" class="gis-ui-panel-host" :style="panelStyle" :class="[`gis-ui-panel-host--${id}`, { 'is-unframed': definition.unframed }]">
    <div v-if="definition.unframed" v-show="!state.collapsed" class="gis-ui-panel-content">
      <component :is="definition.component" v-bind="definition.props" />
    </div>
    <PanelShell
      v-else
      :title="displayTitle"
      :icon="definition.icon"
      :collapsed="state.collapsed"
      :collapsible="definition.collapsible ?? true"
      :closable="definition.closable ?? true"
      :labels="{ expand: ui.locale.t('action.expand'), collapse: ui.locale.t('action.collapse'), close: ui.locale.t('action.closePanel') }"
      @collapse="state.collapsed ? ui.panels.expand(id) : ui.panels.collapse(id)"
      @close="ui.panels.hide(id)"
    >
      <component :is="definition.component" v-bind="definition.props" />
    </PanelShell>
  </div>
</template>
