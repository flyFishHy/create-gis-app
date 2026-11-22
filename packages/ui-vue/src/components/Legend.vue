<script setup lang="ts">
import { computed } from 'vue'
import type { LegendDefinition, LayerStyle } from '@joinmap/gis-core'
import LegendSwatch from './LegendSwatch.vue'
const props = withDefaults(
  defineProps<{
    definitions?: readonly LegendDefinition[]
    titles?: Readonly<Record<string, string>>
    emptyText?: string
    styles?: Readonly<Record<string, LayerStyle>>
    symbols?: Readonly<Record<string, string>>
    defaultText?: string
    typeLabels?: Readonly<Record<string, string>>
    fieldLabel?: string
    uniformText?: string
    layerColorText?: string
    filterable?: boolean
    activeRule?: string
  }>(),
  { emptyText: 'No legend definitions' }
)
const emit = defineEmits<{ filter: [id: string] }>()
const groups = computed(() => {
  const result = new Map<string, { id: string; title: string; definitions: LegendDefinition[] }>()
  for (const definition of props.definitions ?? []) {
    const key = definition.layerId ?? definition.id
    const group = result.get(key) ?? {
      id: key,
      title: props.titles?.[key] || definition.title || key,
      definitions: [],
    }
    group.definitions.push(definition)
    result.set(key, group)
  }
  return [...result.values()]
})

function continuousStops(legend: LegendDefinition) {
  return [...(legend.stops ?? [])]
    .filter((stop) => Number.isFinite(stop.value))
    .sort((a, b) => a.value - b.value)
}
function gradient(legend: LegendDefinition) {
  const stops = continuousStops(legend)
  const min = stops[0]?.value ?? 0,
    max = stops.at(-1)?.value ?? min
  return `linear-gradient(to right, ${stops.map((stop) => `${stop.color} ${max === min ? 0 : ((stop.value - min) / (max - min)) * 100}%`).join(', ')})`
}
</script>

<template>
  <div class="gis-ui-legend">
    <p v-if="groups.length === 0" class="gis-ui-empty">{{ emptyText }}</p>
    <section v-for="group in groups" :key="group.id" class="gis-ui-legend-group">
      <div class="gis-ui-legend-heading">
        <h3 :title="group.title">{{ group.title }}</h3>
        <slot name="group-actions" :layer-id="group.id" />
      </div>
      <div v-for="legend in group.definitions" :key="legend.id" class="gis-ui-legend-definition">
        <div v-if="legend.field || legend.type !== 'category'" class="gis-ui-legend-metric">
          <span class="gis-ui-legend-metric-value" :title="legend.field">{{ legend.field }}</span>
          <span class="gis-ui-legend-mode">{{ typeLabels?.[legend.type] ?? legend.type }}</span>
        </div>
        <img
          v-if="legend.type === 'image' && legend.imageUrl"
          class="gis-ui-legend-image"
          :src="legend.imageUrl"
          :alt="legend.title ?? group.title"
        />
        <div
          v-else-if="legend.type === 'continuous' && continuousStops(legend).length > 1"
          class="gis-ui-legend-continuous"
        >
          <div
            class="gis-ui-legend-gradient"
            :style="{ background: gradient(legend) }"
            role="img"
            :aria-label="legend.title ?? group.title"
          />
          <div class="gis-ui-legend-scale">
            <span v-for="stop in continuousStops(legend)" :key="`${stop.value}-${stop.color}`">{{
              stop.label ?? stop.value
            }}</span>
          </div>
        </div>
        <ul v-else-if="legend.type === 'interval' && legend.ranges" class="gis-ui-legend-items">
          <li v-for="range in legend.ranges" :key="range.id">
            <component
              :is="filterable ? 'button' : 'span'"
              class="gis-ui-legend-rule"
              :type="filterable ? 'button' : undefined"
              :aria-pressed="filterable ? activeRule === range.id : undefined"
              @click="filterable && emit('filter', range.id)"
            >
              <LegendSwatch
                :color="range.color"
                :symbol="symbols?.[group.id]"
                :layer-style="styles?.[group.id]"
              />
              <span class="gis-ui-legend-range-text">{{
                `[${range.min}, ${range.max}${range.includeMax ? ']' : ')'}`
              }}</span>
              <small v-if="range.label">{{ range.label }}</small>
            </component>
          </li>
        </ul>
        <div v-else-if="legend.stops?.length" class="gis-ui-legend-stops">
          <span
            v-for="stop in legend.stops"
            :key="`${stop.value}-${stop.color}`"
            class="gis-ui-legend-stop"
          >
            <i :style="{ backgroundColor: stop.color }" />{{ stop.label ?? stop.value }}
          </span>
        </div>
        <ul v-if="legend.items?.length" class="gis-ui-legend-items">
          <li
            v-for="item in legend.items"
            :key="item.id"
            :class="{ 'is-disabled': item.visible === false }"
            :title="item.values?.map(String).join(', ')"
          >
            <component
              :is="filterable && legend.type === 'category' ? 'button' : 'span'"
              class="gis-ui-legend-rule"
              :type="filterable && legend.type === 'category' ? 'button' : undefined"
              :aria-pressed="
                filterable && legend.type === 'category' ? activeRule === item.id : undefined
              "
              @click="filterable && legend.type === 'category' && emit('filter', item.id)"
            >
              <LegendSwatch
                :color="item.color"
                :symbol="symbols?.[group.id] ?? item.symbol"
                :layer-style="styles?.[group.id]"
              />
              <span>{{ item.label || item.values?.map(String).join(', ') || item.value }}</span>
            </component>
          </li>
        </ul>
        <div v-if="legend.noData" class="gis-ui-legend-no-data">
          <i :style="legend.noData.color ? { backgroundColor: legend.noData.color } : undefined" />
          {{ legend.noData.label }}
        </div>
        <ul
          v-if="
            styles?.[group.id] &&
            ((legend.type === 'category' && (legend.field || !legend.items?.length)) ||
              (legend.type === 'interval' && legend.field))
          "
          class="gis-ui-legend-items"
          :class="{ 'gis-ui-legend-default-display': legend.field }"
        >
          <li>
            <LegendSwatch :symbol="symbols?.[group.id]" :layer-style="styles[group.id]" />
            <span>{{
              legend.field ? (defaultText ?? 'Unmatched values') : (layerColorText ?? 'Layer color')
            }}</span>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
