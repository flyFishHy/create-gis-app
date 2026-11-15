<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { parseGISAppConfig, type LayerField, type LayerLegend, type LegendItem, type LegendRange } from '@joinmap/gis-core'
import type { LegendEditValue, UniformLayerStyle } from './legend-editor-types.js'
import LegendColor from './LegendColor.vue'

const props = defineProps<{
  legend?: LayerLegend
  layerStyle?: UniformLayerStyle
  fields?: readonly LayerField[]
  symbol?: string
  title?: string
  saving?: boolean
  blocked?: boolean
  error?: string
  labels?: Readonly<Record<string, string>>
}>()
const emit = defineEmits<{ submit: [value: LegendEditValue]; cancel: [] }>()
const defaults: Record<string, string> = {
  title: 'Legend title', color: 'Color', category: 'Category', interval: 'Interval', field: 'Field', value: 'Value', item: 'Label',
  default: 'Other values', add: 'Add', remove: 'Delete', reset: 'Reset', save: 'Save', cancel: 'Close', more: 'More', pending: 'More settings coming soon',
  invalid: 'Check matching values, non-overlapping intervals and valid colors.', min: 'Minimum', max: 'Maximum', valueType: 'Value type',
}
const text = (key: string) => props.labels?.[key] ?? defaults[key] ?? key
const uid = useId()
let sequence = 0
const copyLegend = () => JSON.parse(JSON.stringify(props.legend ?? { type: 'category', title: props.title ?? '', items: [] })) as LayerLegend
const draft = ref(copyLegend())
const initialStyle = () => ({ fillColor: '#ffffff66', strokeColor: '#3399cc', strokeWidth: 1.25, pointRadius: 5, ...props.layerStyle })
const style = ref<UniformLayerStyle>(initialStyle())
const validation = ref('')
const items = computed(() => draft.value.items ?? [])
const ranges = computed(() => draft.value.ranges ?? [])
const defaultColor = computed({ get: () => props.symbol === 'line' ? style.value.strokeColor : style.value.fillColor,
  set: color => { if (props.symbol === 'line') style.value.strokeColor = color; else style.value.fillColor = color } })
const fields = computed(() => (props.fields ?? []).filter(field => draft.value.type !== 'interval' || field.type === 'number'))
const id = () => `${uid}-${++sequence}`
function reset() { draft.value = copyLegend(); style.value = initialStyle(); validation.value = '' }
function setType(event: Event) {
  const type = (event.target as HTMLSelectElement).value as 'category' | 'interval'
  draft.value = { title: draft.value.title, type, ...(type === 'category' ? { items: [] } : { ranges: [] }) }
}
function setField(event: Event) {
  const field = (event.target as HTMLInputElement).value || undefined
  const type = props.fields?.find(item => item.name === field)?.type
  draft.value = { ...draft.value, field, useLayerStyle: false, items: items.value.map(item => ({ ...item, value: item.value ?? (type === 'number' ? 0 : type === 'boolean' ? false : '') })) }
}
function add() {
  if (draft.value.type === 'interval') {
    const min = ranges.value.length ? Math.max(...ranges.value.map(range => range.max)) : 0
    draft.value = { ...draft.value, ranges: [...ranges.value, { id: id(), min, max: min + 100, color: defaultColor.value }] }
  } else draft.value = { ...draft.value, items: [...items.value, { id: id(), value: '', label: '', color: defaultColor.value }], useLayerStyle: false }
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
function setValue(index: number, input: string, type: string = typeof items.value[index]?.value) {
  changeItem(index, { value: type === 'number' ? Number(input) : type === 'boolean' ? input === 'true' : input })
}
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
    parseGISAppConfig({ layers: [{ id: 'draft', type: 'geojson', style: style.value, legend }] })
    emit('submit', { legend, ...(props.layerStyle ? { style: { ...style.value } } : {}) })
  } catch { validation.value = text('invalid') }
}
</script>

<template>
  <form class="gis-ui-legend-editor gis-ui-legend-card" @submit.prevent="submit">
    <header class="gis-ui-legend-card-header">
      <input class="gis-ui-legend-title-input" name="legendTitle" :aria-label="text('title')" :value="draft.title ?? title" :disabled="saving" @input="draft = { ...draft, title: ($event.target as HTMLInputElement).value }">
      <span class="gis-ui-legend-kind">{{ text(draft.type) }}</span>
      <div class="gis-ui-legend-card-actions">
        <button type="submit" class="is-primary" :disabled="saving || blocked" :aria-label="text('save')" :title="text('save')">✓</button>
        <button type="button" :disabled="saving" :aria-label="text('reset')" :title="text('reset')" @click="reset">↺</button>
        <button type="button" :disabled="saving" :aria-label="text('cancel')" :title="text('cancel')" @click="emit('cancel')">×</button>
      </div>
    </header>
    <p v-if="error || validation" class="gis-ui-error" role="alert">{{ error || validation }}</p>
    <fieldset :disabled="saving || blocked" class="gis-ui-legend-rule-settings">
      <select v-if="draft.type === 'category' || draft.type === 'interval'" name="legendType" :aria-label="text('category') + '/' + text('interval')" :value="draft.type" @change="setType">
        <option value="category">{{ text('category') }}</option><option value="interval">{{ text('interval') }}</option>
      </select>
      <label v-if="draft.type === 'category' || draft.type === 'interval'" class="gis-ui-legend-field">{{ text('field') }}
        <input name="legendField" :list="`${uid}-fields`" :value="draft.field ?? ''" :aria-label="text('field')" @input="setField">
        <datalist :id="`${uid}-fields`"><option v-for="field in fields" :key="field.name" :value="field.name" /></datalist>
      </label>
      <template v-if="draft.type === 'interval'">
        <div v-for="(range, index) in ranges" :key="range.id" class="gis-ui-legend-rule-row">
          <LegendColor :model-value="range.color" :symbol="symbol" :label="`${text('color')} ${index + 1}`" @update:model-value="changeRange(index, { color: $event })" />
          <input :name="`rangeMin-${index}`" type="number" step="any" required :aria-label="`${text('min')} ${index + 1}`" :value="range.min" @input="changeRange(index, { min: Number(($event.target as HTMLInputElement).value) })">
          <span>–</span>
          <input :name="`rangeMax-${index}`" type="number" step="any" required :aria-label="`${text('max')} ${index + 1}`" :value="range.max" @input="changeRange(index, { max: Number(($event.target as HTMLInputElement).value) })">
          <button type="button" :aria-label="`${text('remove')} ${index + 1}`" @click="remove(index)">×</button>
        </div>
      </template>
      <template v-else-if="draft.type === 'category'">
        <div v-for="(item, index) in items" :key="item.id" class="gis-ui-legend-category-row">
          <LegendColor :model-value="item.color ?? defaultColor" :symbol="symbol" :label="`${text('color')} ${index + 1}`" @update:model-value="changeItem(index, { color: $event })" />
          <template v-if="draft.field">
            <select :aria-label="`${text('valueType')} ${index + 1}`" :value="typeof item.value" @change="setValue(index, String(item.value ?? ''), ($event.target as HTMLSelectElement).value)"><option value="string">ABC</option><option value="number">123</option><option value="boolean">T/F</option></select>
            <select v-if="typeof item.value === 'boolean'" :aria-label="`${text('value')} ${index + 1}`" :value="String(item.value)" @change="setValue(index, ($event.target as HTMLSelectElement).value)"><option value="true">true</option><option value="false">false</option></select>
            <input v-else :name="`itemValue-${index}`" :type="typeof item.value === 'number' ? 'number' : 'text'" :required="typeof item.value === 'number'" step="any" :aria-label="`${text('value')} ${index + 1}`" :placeholder="text('value')" :value="item.value" @input="setValue(index, ($event.target as HTMLInputElement).value)">
          </template>
          <input :name="`itemLabel-${index}`" :aria-label="`${text('item')} ${index + 1}`" :placeholder="text('item')" :value="item.label" @input="changeItem(index, { label: ($event.target as HTMLInputElement).value })">
          <button type="button" :aria-label="`${text('remove')} ${index + 1}`" @click="remove(index)">×</button>
        </div>
      </template>
      <template v-else-if="draft.type === 'continuous'">
        <div v-for="(stop, index) in draft.stops" :key="index" class="gis-ui-legend-rule-row">
          <LegendColor :model-value="stop.color" :label="`${text('color')} ${index + 1}`" @update:model-value="draft = { ...draft, stops: draft.stops?.map((value, i) => i === index ? { ...value, color: $event } : value) }" />
          <span>{{ stop.label ?? stop.value }}</span>
        </div>
      </template>
      <img v-else-if="draft.imageUrl" class="gis-ui-legend-image" :src="draft.imageUrl" :alt="draft.title">
      <div class="gis-ui-legend-default"><LegendColor v-model="defaultColor" :symbol="symbol" :label="text('default')" /><span>{{ text('default') }}</span></div>
      <div class="gis-ui-legend-editor-footer">
        <button v-if="draft.type === 'category' || draft.type === 'interval'" type="button" class="gis-ui-legend-add" @click="add">+ {{ text('add') }}</button>
        <button type="button" disabled :title="text('pending')">{{ text('more') }}</button>
      </div>
    </fieldset>
  </form>
</template>
