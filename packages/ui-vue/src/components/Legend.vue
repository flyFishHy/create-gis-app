<script setup lang="ts">
import { computed } from 'vue'
import type { LegendDefinition } from '@joinmap/gis-core'
const props = withDefaults(defineProps<{
  definitions?: readonly LegendDefinition[]
  titles?: Readonly<Record<string, string>>
  emptyText?: string
}>(), { emptyText: 'No legend definitions' })
const groups = computed(() => {
  const result = new Map<string, { id: string; title: string; definitions: LegendDefinition[] }>()
  for (const definition of props.definitions ?? []) {
    const key = definition.layerId ?? definition.id
    const group = result.get(key) ?? { id: key, title: props.titles?.[key] ?? definition.title ?? key, definitions: [] }
    group.definitions.push(definition)
    result.set(key, group)
  }
  return [...result.values()]
})

function continuousStops(legend: LegendDefinition) {
  return [...(legend.stops ?? [])].filter(stop => Number.isFinite(stop.value)).sort((a, b) => a.value - b.value)
}
function gradient(legend: LegendDefinition) {
  const stops = continuousStops(legend)
  const min = stops[0]?.value ?? 0, max = stops.at(-1)?.value ?? min
  return `linear-gradient(to right, ${stops.map(stop => `${stop.color} ${max === min ? 0 : (stop.value - min) / (max - min) * 100}%`).join(', ')})`
}
</script>

<template>
  <div class="gis-ui-legend">
    <p v-if="groups.length === 0" class="gis-ui-empty">{{ emptyText }}</p>
    <section v-for="group in groups" :key="group.id" class="gis-ui-legend-group">
      <div class="gis-ui-legend-heading"><h3>{{ group.title }}</h3><slot name="group-actions" :layer-id="group.id" /></div>
      <div v-for="legend in group.definitions" :key="legend.id" class="gis-ui-legend-definition">
        <h4 v-if="legend.title && legend.title !== group.title">{{ legend.title }}</h4>
        <img v-if="legend.type === 'image' && legend.imageUrl" class="gis-ui-legend-image" :src="legend.imageUrl" :alt="legend.title ?? group.title">
        <div v-else-if="legend.type === 'continuous' && continuousStops(legend).length > 1" class="gis-ui-legend-continuous">
          <div class="gis-ui-legend-gradient" :style="{ background: gradient(legend) }" role="img" :aria-label="legend.title ?? group.title" />
          <div class="gis-ui-legend-scale">
            <span v-for="stop in continuousStops(legend)" :key="`${stop.value}-${stop.color}`">{{ stop.label ?? stop.value }}</span>
          </div>
        </div>
        <div v-else-if="legend.stops?.length" class="gis-ui-legend-stops">
          <span v-for="stop in legend.stops" :key="`${stop.value}-${stop.color}`" class="gis-ui-legend-stop">
            <i :style="{ backgroundColor: stop.color }" />{{ stop.label ?? stop.value }}
          </span>
        </div>
        <ul v-if="legend.items?.length" class="gis-ui-legend-items">
          <li v-for="item in legend.items" :key="item.id" :class="{ 'is-disabled': item.visible === false }">
            <i :class="`symbol-${item.symbol ?? 'fill'}`" :style="item.color ? { backgroundColor: item.color, borderColor: item.color } : undefined" />
            <span>{{ item.label }}</span>
          </li>
        </ul>
        <div v-if="legend.noData" class="gis-ui-legend-no-data">
          <i :style="legend.noData.color ? { backgroundColor: legend.noData.color } : undefined" />
          {{ legend.noData.label }}
        </div>
      </div>
    </section>
  </div>
</template>
