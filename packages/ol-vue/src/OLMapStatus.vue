<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getPointResolution, toLonLat } from 'ol/proj.js'
import { unByKey } from 'ol/Observable.js'
import type { EventsKey } from 'ol/events.js'
import { useOLMap } from '@joinmap/adapter-ol'
import { MapStatusPanel, useAppState, useGISApp } from '@joinmap/ui-vue'

const app = useGISApp()
const snapshot = useAppState()
const coordinate = ref<readonly [number, number]>()
let pointerKey: EventsKey | undefined
const scale = computed(() => {
  const { projection, resolution, center } = snapshot.value.map
  if (!projection || resolution === null || !center) return undefined
  const meters = getPointResolution(projection, resolution, [...center], 'm')
  return Number.isFinite(meters) ? `1:${Math.round(meters / 0.00028).toLocaleString()}` : undefined
})
onMounted(() => {
  const map = useOLMap(app)
  pointerKey = map.on('pointermove', (event) => {
    if (event.dragging) return
    const [lon, lat] = toLonLat(event.coordinate, map.getView().getProjection())
    coordinate.value = [lon!, lat!]
  })
})
onBeforeUnmount(() => { if (pointerKey) unByKey(pointerKey) })
</script>

<template>
  <MapStatusPanel :coordinate="coordinate" :scale="scale" />
</template>
