<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { parseGISAppConfig, type LayerField, type LayerLegend, type LegendItem, type LegendRange, type LegendValue } from '@joinmap/gis-core'
import type { LegendEditValue, UniformLayerStyle } from './legend-editor-types.js'
import { selectValueKey } from './select-values.js'
import LegendColor from './LegendColor.vue'
import LegendKind from './LegendKind.vue'
import LegendAction from './LegendAction.vue'
import GisSelect from './GisSelect.vue'
import GisMultiSelect from './GisMultiSelect.vue'
import SvgIcon from './SvgIcon.vue'

const props = defineProps<{
  legend?: LayerLegend
  layerStyle?: UniformLayerStyle
  fields?: readonly LayerField[]
  getFieldValues?: (field: string) => readonly LegendValue[]
  symbol?: string
  title?: string
  saving?: boolean
  blocked?: boolean
  error?: string
  labels?: Readonly<Record<string, string>>
}>()
const emit = defineEmits<{ submit: [value: LegendEditValue]; cancel: [] }>()
const defaults: Record<string, string> = {
  title: 'Legend', color: 'Color', category: 'Category', interval: 'Interval', continuous: 'Continuous', image: 'Image', field: 'Metric', value: 'Matching values', item: 'Label',
  default: 'Other values', add: 'Add rule', remove: 'Delete', reset: 'Reset', save: 'Save', cancel: 'Close',
  invalid: 'Check matching values, non-overlapping intervals and valid colors.', min: 'Minimum', max: 'Maximum',
  uniform: 'Uniform style', search: 'Search values', clear: 'Clear selection', empty: 'No matching values', missing: 'Not in current data', used: 'Used by', inclusive: 'Include upper boundary',
}
const text = (key: string) => props.labels?.[key] ?? defaults[key] ?? key
const uid = useId()
let sequence = 0
function copyLegend(): LayerLegend {
  const copy = JSON.parse(JSON.stringify(props.legend ?? { type: 'category', items: [] })) as LayerLegend
  return { ...copy, ...(copy.items ? { items: copy.items.map(({ value, ...item }) => value === undefined ? item : { ...item, values: [value] }) } : {}) }
}
const draft = ref(copyLegend())
const initialStyle = () => ({ fillColor: '#ffffff66', strokeColor: '#3399cc', strokeWidth: 1.25, pointRadius: 5, ...props.layerStyle })
const style = ref<UniformLayerStyle>(initialStyle())
const validation = ref(''), candidates = ref<readonly LegendValue[]>([])
const items = computed(() => draft.value.items ?? [])
const ranges = computed(() => draft.value.ranges ?? [])
const defaultColor = computed({ get: () => props.symbol === 'line' ? style.value.strokeColor : style.value.fillColor,
  set: color => { if (props.symbol === 'line') style.value.strokeColor = color; else style.value.fillColor = color } })
const fields = computed(() => (props.fields ?? []).filter(field => draft.value.type !== 'interval' || field.type === 'number'))
const fieldOptions = computed(() => {
  const options = fields.value.map(field => ({ value: field.name, label: field.name }))
  if (draft.value.field && !options.some(field => field.value === draft.value.field)) options.unshift({ value: draft.value.field, label: draft.value.field })
  if (draft.value.type === 'category') options.unshift({ value: '', label: text('uniform') })
  return options
})
function refreshValues() {
  try { candidates.value = draft.value.field ? props.getFieldValues?.(draft.value.field) ?? [] : [] }
  catch { candidates.value = []; validation.value = text('invalid') }
}
function options(index: number) {
  const used = new Map(items.value.flatMap((item, i) => i === index ? [] : (item.values ?? []).map(value => [selectValueKey(value), item.label || item.id] as const)))
  return candidates.value.map(value => ({ value, label: String(value) || '""', disabled: used.has(selectValueKey(value)), hint: used.has(selectValueKey(value)) ? `${text('used')}: ${used.get(selectValueKey(value))}` : undefined }))
}
function reset() { draft.value = copyLegend(); style.value = initialStyle(); validation.value = ''; refreshValues() }
function setField(field: string) { draft.value = { ...draft.value, field: field || undefined, useLayerStyle: false }; validation.value = ''; refreshValues() }
function add() {
  const id = `${uid}-${++sequence}`
  if (draft.value.type === 'interval') {
    const min = ranges.value.length ? Math.max(...ranges.value.map(range => range.max)) : 0
    draft.value = { ...draft.value, ranges: [...ranges.value, { id, min, max: min + 100, color: defaultColor.value }] }
  } else draft.value = { ...draft.value, items: [...items.value, { id, values: [], label: '', color: defaultColor.value }], useLayerStyle: false }
}
function remove(index: number) {
  draft.value = draft.value.type === 'interval' ? { ...draft.value, ranges: ranges.value.filter((_, i) => i !== index) }
    : { ...draft.value, items: items.value.filter((_, i) => i !== index), useLayerStyle: false }
}
function changeItem(index: number, patch: Partial<LegendItem>) {
  const uniform = !draft.value.field && items.value.length === 1 && !!props.layerStyle
  if (uniform && patch.color) defaultColor.value = patch.color
  draft.value = { ...draft.value, useLayerStyle: uniform, items: items.value.map((item, i) => i === index ? { ...item, ...patch } : item) }
}
function changeRange(index: number, patch: Partial<LegendRange>) { draft.value = { ...draft.value, ranges: ranges.value.map((range, i) => i === index ? { ...range, ...patch } : range) } }
function validColor(value: string) { const node = document.createElement('span'); node.style.color = value; return !!node.style.color }
function submit() {
  if (props.saving || props.blocked) return
  validation.value = ''
  try {
    let legend: LayerLegend = JSON.parse(JSON.stringify(draft.value))
    if (legend.type === 'category' && !legend.field && items.value.length > 1) throw new Error()
    if (legend.type === 'interval') {
      if (!legend.field) throw new Error()
      legend = { ...legend, ranges: [...ranges.value].sort((a, b) => a.min - b.min) }
    }
    if (!validColor(style.value.fillColor) || !validColor(style.value.strokeColor)
      || items.value.some(item => item.color && !validColor(item.color)) || ranges.value.some(range => !validColor(range.color))) throw new Error()
    const normalized = parseGISAppConfig({ layers: [{ id: 'draft', type: 'geojson', style: style.value, legend }] }).layers![0]!.legend!
    emit('submit', { legend: normalized, ...(props.layerStyle ? { style: { ...style.value } } : {}) })
  } catch { validation.value = text('invalid') }
}
refreshValues()
</script>

<template>
  <form class="gis-ui-legend-editor gis-ui-legend-card" @submit.prevent="submit">
    <header class="gis-ui-legend-card-header">
      <h3 :title="title ?? draft.title">{{ title ?? draft.title ?? text('title') }}</h3>
      <LegendKind :type="draft.type" :label="text(draft.type)" />
      <div class="gis-ui-legend-card-actions">
        <LegendAction icon="save" type="submit" primary :disabled="saving || blocked" :label="text('save')" />
        <LegendAction icon="reset" :disabled="saving" :label="text('reset')" @click="reset" />
        <LegendAction icon="close" :disabled="saving" :label="text('cancel')" @click="emit('cancel')" />
      </div>
    </header>
    <p v-if="error || validation" class="gis-ui-error" role="alert">{{ error || validation }}</p>
    <fieldset :disabled="saving || blocked" class="gis-ui-legend-rule-settings">
      <div class="gis-ui-legend-metric"><span>{{ text('field') }}</span>
        <GisSelect v-if="draft.type === 'category' || draft.type === 'interval'" :model-value="draft.field ?? ''" :options="fieldOptions" :label="text('field')" :disabled="saving || blocked" :placeholder="text('uniform')" floating @update:model-value="setField" />
        <span v-else class="gis-ui-legend-metric-value">{{ draft.field || text('uniform') }}</span>
      </div>
      <div v-if="draft.type === 'interval'" class="gis-ui-legend-rule-list">
        <div v-for="(range, index) in ranges" :key="range.id" class="gis-ui-legend-rule-row">
          <LegendColor :model-value="range.color" :symbol="symbol" :label="`${text('color')} ${index + 1}`" @update:model-value="changeRange(index, { color: $event })" />
          <div class="gis-ui-legend-boundary"><span>[</span><input :name="`rangeMin-${index}`" type="number" step="any" required :aria-label="`${text('min')} ${index + 1}`" :value="range.min" @input="changeRange(index, { min: Number(($event.target as HTMLInputElement).value) })"><span>,</span><input :name="`rangeMax-${index}`" type="number" step="any" required :aria-label="`${text('max')} ${index + 1}`" :value="range.max" @input="changeRange(index, { max: Number(($event.target as HTMLInputElement).value) })"><button type="button" class="gis-ui-legend-endpoint" :aria-label="`${text('inclusive')} ${index + 1}`" :aria-pressed="!!range.includeMax" :title="text('inclusive')" @click="changeRange(index, { includeMax: !range.includeMax })">{{ range.includeMax ? ']' : ')' }}</button></div>
          <LegendAction icon="close" :disabled="saving || blocked" :label="`${text('remove')} ${index + 1}`" @click="remove(index)" />
        </div>
      </div>
      <div v-else-if="draft.type === 'category'" class="gis-ui-legend-rule-list">
        <div v-for="(item, index) in items" :key="item.id" class="gis-ui-legend-category-row" :class="{ 'is-uniform': !draft.field }">
          <LegendColor :model-value="item.color ?? defaultColor" :symbol="symbol" :label="`${text('color')} ${index + 1}`" @update:model-value="changeItem(index, { color: $event })" />
          <GisMultiSelect v-if="draft.field" :model-value="item.values ?? []" :options="options(index)" :label="`${text('value')} ${index + 1}`" :disabled="saving || blocked" :placeholder="text('value')" :search-text="text('search')" :clear-text="text('clear')" :empty-text="text('empty')" :missing-text="text('missing')" @open="refreshValues" @update:model-value="changeItem(index, { values: $event })" />
          <input :name="`itemLabel-${index}`" :aria-label="`${text('item')} ${index + 1}`" :placeholder="text('item')" :value="item.label" @input="changeItem(index, { label: ($event.target as HTMLInputElement).value })">
          <LegendAction icon="close" :disabled="saving || blocked" :label="`${text('remove')} ${index + 1}`" @click="remove(index)" />
        </div>
      </div>
      <template v-else-if="draft.type === 'continuous'">
        <div v-for="(stop, index) in draft.stops" :key="index" class="gis-ui-legend-stop-editor"><LegendColor :model-value="stop.color" :label="`${text('color')} ${index + 1}`" @update:model-value="draft = { ...draft, stops: draft.stops?.map((value, i) => i === index ? { ...value, color: $event } : value) }" /><span>{{ stop.label ?? stop.value }}</span></div>
      </template>
      <img v-else-if="draft.imageUrl" class="gis-ui-legend-image" :src="draft.imageUrl" :alt="draft.title">
      <div v-if="layerStyle && (draft.field || !items.length) && draft.type !== 'image'" class="gis-ui-legend-default"><LegendColor v-model="defaultColor" :symbol="symbol" :label="text('default')" /><span>{{ text('default') }}</span></div>
      <div v-if="draft.type === 'interval' || (draft.type === 'category' && draft.field)" class="gis-ui-legend-editor-footer"><button type="button" class="gis-ui-legend-add" @click="add"><SvgIcon name="plus" :size="13" />{{ text('add') }}</button></div>
    </fieldset>
  </form>
</template>
