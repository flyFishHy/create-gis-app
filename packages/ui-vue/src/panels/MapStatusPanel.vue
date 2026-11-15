<script setup lang="ts">
import { computed } from 'vue'
import { useAppState } from '../use-app-state.js'
import { useGISUI } from '../use-gis-ui.js'

defineProps<{ coordinate?: readonly [number, number]; scale?: string }>()
const snapshot = useAppState()
const ui = useGISUI()
const level = computed(() => {
  const zoom = snapshot.value.map.zoom
  return zoom === null ? '—' : Number(zoom.toFixed(2)).toString()
})
</script>

<template>
  <div class="gis-ui-map-status-panel" aria-label="Map status">
    <div class="gis-ui-status-coordinates">
      <span :title="coordinate ? undefined : ui.locale.t('status.movePointer')"><span class="gis-ui-status-label">{{ ui.locale.t('status.longitude') }}</span><output aria-live="off">{{ coordinate ? coordinate[0].toFixed(5) + '°' : '—' }}</output></span>
      <span :title="coordinate ? undefined : ui.locale.t('status.movePointer')"><span class="gis-ui-status-label">{{ ui.locale.t('status.latitude') }}</span><output aria-live="off">{{ coordinate ? coordinate[1].toFixed(5) + '°' : '—' }}</output></span>
    </div>
    <div class="gis-ui-status-details">
      <span><span class="gis-ui-status-label">{{ ui.locale.t('status.level') }}</span><output aria-label="Map level">{{ level }}</output></span>
      <span><span class="gis-ui-status-label">{{ ui.locale.t('status.scale') }}</span><output>{{ scale || '—' }}</output></span>
      <span class="gis-ui-status-projection"><span class="gis-ui-status-label">{{ ui.locale.t('status.projection') }}</span><output>{{ snapshot.map.projection || '—' }}</output></span>
    </div>
  </div>
</template>
