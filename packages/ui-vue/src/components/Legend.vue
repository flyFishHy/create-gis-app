<script setup lang="ts">
import { computed } from 'vue'
import type { LegendDefinition, LayerStyle } from '@joinmap/gis-core'
import LegendKind from './LegendKind.vue'
const props = withDefaults(defineProps<{
  definitions?: readonly LegendDefinition[]
  titles?: Readonly<Record<string, string>>
  emptyText?: string
  styles?: Readonly<Record<string, LayerStyle>>
  symbols?: Readonly<Record<string, string>>
  defaultText?: string
  typeLabels?: Readonly<Record<string, string>>
  fieldLabel?: string
  uniformText?: string
}>(), { emptyText: 'No legend definitions' })
const groups = computed(() => {
  const result = new Map<string, { id: string; title: string; definitions: LegendDefinition[] }>()
  for (const definition of props.definitions ?? []) {
    const key = definition.layerId ?? definition.id
    const group = result.get(key) ?? { id: key, title: props.titles?.[key] || definition.title || key, definitions: [] }
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
      <div class="gis-ui-legend-heading"><h3 :title="group.title">{{ group.title }}</h3><LegendKind :type="group.definitions[0]!.type" :label="typeLabels?.[group.definitions[0]!.type] ?? group.definitions[0]!.type" /><slot name="group-actions" :layer-id="group.id" /></div>
      <div v-for="legend in group.definitions" :key="legend.id" class="gis-ui-legend-definition">
        <div class="gis-ui-legend-metric"><span>{{ fieldLabel ?? 'Metric' }}</span><span class="gis-ui-legend-metric-value" :title="legend.field">{{ legend.field || uniformText || 'Uniform style' }}</span></div>
        <img v-if="legend.type === 'image' && legend.imageUrl" class="gis-ui-legend-image" :src="legend.imageUrl" :alt="legend.title ?? group.title">
        <div v-else-if="legend.type === 'continuous' && continuousStops(legend).length > 1" class="gis-ui-legend-continuous">
          <div class="gis-ui-legend-gradient" :style="{ background: gradient(legend) }" role="img" :aria-label="legend.title ?? group.title" />
          <div class="gis-ui-legend-scale">
            <span v-for="stop in continuousStops(legend)" :key="`${stop.value}-${stop.color}`">{{ stop.label ?? stop.value }}</span>
          </div>
        </div>
        <ul v-else-if="legend.type === 'interval' && legend.ranges" class="gis-ui-legend-items">
          <li v-for="range in legend.ranges" :key="range.id"><i :class="`symbol-${symbols?.[group.id] ?? 'fill'}`" :style="{ backgroundColor: range.color, borderColor: range.color }" /><span class="gis-ui-legend-range-text">{{ `[${range.min}, ${range.max}${range.includeMax ? ']' : ')'}` }}</span><small v-if="range.label">{{ range.label }}</small></li>
        </ul>
        <div v-else-if="legend.stops?.length" class="gis-ui-legend-stops">
          <span v-for="stop in legend.stops" :key="`${stop.value}-${stop.color}`" class="gis-ui-legend-stop">
            <i :style="{ backgroundColor: stop.color }" />{{ stop.label ?? stop.value }}
          </span>
        </div>
        <ul v-if="legend.items?.length" class="gis-ui-legend-items">
          <li v-for="item in legend.items" :key="item.id" :class="{ 'is-disabled': item.visible === false }" :title="item.values?.map(String).join(', ')">
            <i :class="`symbol-${symbols?.[group.id] ?? item.symbol ?? 'fill'}`" :style="item.color ? { backgroundColor: item.color, borderColor: item.color } : undefined" />
            <span>{{ item.label || item.values?.map(String).join(', ') || item.value }}</span>
          </li>
        </ul>
        <div v-if="legend.noData" class="gis-ui-legend-no-data">
          <i :style="legend.noData.color ? { backgroundColor: legend.noData.color } : undefined" />
          {{ legend.noData.label }}
        </div>
        <ul v-if="styles?.[group.id] && legend.type !== 'image' && (legend.field || !legend.items?.length)" class="gis-ui-legend-items gis-ui-legend-default-display"><li><i :class="`symbol-${symbols?.[group.id] ?? 'fill'}`" :style="{ backgroundColor: symbols?.[group.id] === 'line' ? styles[group.id]!.strokeColor : styles[group.id]!.fillColor }" /><span>{{ defaultText ?? 'Other values' }}</span></li></ul>
      </div>
    </section>
  </div>
</template>
