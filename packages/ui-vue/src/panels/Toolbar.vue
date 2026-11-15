<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppState } from '../use-app-state.js'
import type { ToolbarItemDefinition } from '../types.js'
import { useGISApp } from '../use-gis-app.js'
import { useGISUI } from '../use-gis-ui.js'
import SvgIcon from '../components/SvgIcon.vue'
import Tooltip from '../components/Tooltip.vue'

withDefaults(defineProps<{ tooltipPlacement?: 'left' | 'right' | 'bottom' }>(), { tooltipPlacement: 'bottom' })
const app = useGISApp()
const ui = useGISUI()
const snapshot = useAppState()
const activeTool = computed(() => snapshot.value.interactions.activeToolId)
const error = ref<string>()
const itemGroups = () => {
  const groups = new Map<string, ToolbarItemDefinition[]>()
  for (const item of ui.toolbar.list()) {
    if (item.toolId && !app.interactions.hasTool(item.toolId)) continue
    const key = item.group ?? ''
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.entries()]
}

function isDisabled(item: ToolbarItemDefinition) {
  // Predicates may read public Runtime services without accessing Vue refs themselves.
  void snapshot.value.revision
  return typeof item.disabled === 'function' ? item.disabled() : item.disabled ?? false
}

async function activate(item: ToolbarItemDefinition) {
  error.value = undefined
  try {
    if (item.toolId) {
      if (activeTool.value === item.toolId) await app.interactions.deactivateTool()
      else await app.interactions.activateTool(item.toolId)
      return
    }
    await item.onClick?.()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
</script>

<template>
  <div v-if="itemGroups().length" class="gis-ui-toolbar-root">
    <div class="gis-ui-toolbar">
      <div v-for="([group, items], groupIndex) in itemGroups()" :key="group || groupIndex" class="gis-ui-toolbar-group" :aria-label="group || undefined">
        <Tooltip v-for="item in items" :key="item.id" :placement="tooltipPlacement"
          :content="item.shortcut ? `${ui.locale.t(item.title)} (${item.shortcut})` : ui.locale.t(item.title)"
          v-slot="{ describedBy }">
          <output v-if="item.display" class="gis-map-level" :aria-label="ui.locale.t(item.title)" :aria-describedby="describedBy">{{ item.display() }}</output>
          <button v-else
            type="button"
            :disabled="isDisabled(item)"
            :class="{ 'is-active': item.toolId ? activeTool === item.toolId : item.active }"
            :aria-label="ui.locale.t(item.title)"
            :aria-describedby="describedBy"
            :aria-pressed="item.toolId ? activeTool === item.toolId : Boolean(item.active)"
            @click="activate(item)"
          >
            <SvgIcon :name="item.icon ?? 'edit'" />
          </button>
        </Tooltip>
      </div>
    </div>
    <p v-if="error" class="gis-ui-error" role="alert">{{ error }}</p>
  </div>
</template>
