<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import type { LayerLegend, LegendItem } from '@joinmap/gis-core'
import type { LegendEditValue, UniformLayerStyle } from './legend-editor-types.js'
import SvgIcon from './SvgIcon.vue'

const props = defineProps<{
  legend?: LayerLegend
  layerStyle?: UniformLayerStyle
  title?: string
  saving?: boolean
  error?: string
  labels?: Readonly<Record<string, string>>
}>()
const emit = defineEmits<{ submit: [value: LegendEditValue]; cancel: [] }>()
const defaults: Record<string, string> = {
  style: 'Map style', fillColor: 'Fill color', strokeColor: 'Stroke color', strokeWidth: 'Line width', pointRadius: 'Point radius',
  enabled: 'Show legend', title: 'Legend title', item: 'Item label', color: 'Legend color', follow: 'Follow map style',
  presentation: 'Legend text and standalone swatches affect the legend only. Map colors are edited above.',
  image: 'This image is provided by the source; only its title can be edited.',
  apply: 'Apply', cancel: 'Cancel', invalid: 'Enter valid colors and positive sizes.', up: 'Move up', down: 'Move down', noData: 'No-data label',
}
const text = (key: string) => props.labels?.[key] ?? defaults[key] ?? key
const fieldId = `gis-legend-editor-${useId()}`
const source = props.legend ?? { type: 'category' as const, title: props.title ?? '', items: [{ id: 'default', label: props.title ?? 'Layer', color: props.layerStyle?.fillColor ?? '#3399cc', symbol: 'fill' as const }], useLayerStyle: !!props.layerStyle }
const enabled = ref(!!props.legend)
const draft = ref({ ...source, title: source.title ?? '', items: (source.items ?? []).map(item => ({ ...item })),
  stops: (source.stops ?? []).map(stop => ({ ...stop })), noData: source.noData ? { ...source.noData } : undefined })
const styleDraft = ref(props.layerStyle ? { ...props.layerStyle } : undefined)
const validation = ref('')
const canFollow = computed(() => !!styleDraft.value && draft.value.type === 'category' && draft.value.items.length === 1)
function itemColor(item: LegendItem) {
  return canFollow.value && draft.value.useLayerStyle ? item.symbol === 'line' ? styleDraft.value!.strokeColor : styleDraft.value!.fillColor : item.color
}
function validColor(value: string | undefined) {
  if (value === undefined) return true
  const style = document.createElement('span').style
  style.color = value
  return !!style.color
}
function move(index: number, direction: -1 | 1) {
  const items = draft.value.items
  if (items[index + direction]) [items[index], items[index + direction]] = [items[index + direction]!, items[index]!]
}
function submit() {
  if (props.saving) return
  validation.value = ''
  const style = styleDraft.value
  if ((style && (!validColor(style.fillColor) || !validColor(style.strokeColor) || !Number.isFinite(style.strokeWidth) || style.strokeWidth <= 0 || !Number.isFinite(style.pointRadius) || style.pointRadius <= 0))
    || (enabled.value && (!draft.value.items.every(item => validColor(item.color)) || !draft.value.stops.every(stop => validColor(stop.color)) || !validColor(draft.value.noData?.color)))) {
    validation.value = text('invalid'); return
  }
  const legend = enabled.value ? JSON.parse(JSON.stringify(draft.value)) as LayerLegend : null
  emit('submit', { legend, ...(style ? { style: { ...style } } : {}) })
}
</script>

<template>
  <form class="gis-ui-legend-editor" @submit.prevent="submit">
    <p v-if="error || validation" class="gis-ui-error" role="alert">{{ error || validation }}</p>
    <fieldset v-if="styleDraft" :disabled="saving">
      <legend>{{ text('style') }}</legend>
      <label :for="`${fieldId}-fill`">{{ text('fillColor') }}<span class="gis-ui-color-field"><i :style="{ background: styleDraft.fillColor }" /><input :id="`${fieldId}-fill`" v-model="styleDraft.fillColor" name="fillColor" type="text" required spellcheck="false"></span></label>
      <label :for="`${fieldId}-stroke`">{{ text('strokeColor') }}<span class="gis-ui-color-field"><i :style="{ background: styleDraft.strokeColor }" /><input :id="`${fieldId}-stroke`" v-model="styleDraft.strokeColor" name="strokeColor" type="text" required spellcheck="false"></span></label>
      <label :for="`${fieldId}-width`">{{ text('strokeWidth') }}<input :id="`${fieldId}-width`" v-model.number="styleDraft.strokeWidth" name="strokeWidth" type="number" min="0" step="any" required></label>
      <label :for="`${fieldId}-radius`">{{ text('pointRadius') }}<input :id="`${fieldId}-radius`" v-model.number="styleDraft.pointRadius" name="pointRadius" type="number" min="0" step="any" required></label>
    </fieldset>
    <fieldset :disabled="saving">
      <label class="gis-ui-editor-check"><input v-model="enabled" name="legendEnabled" type="checkbox">{{ text('enabled') }}</label>
      <template v-if="enabled">
        <label :for="`${fieldId}-title`">{{ text('title') }}<input :id="`${fieldId}-title`" v-model="draft.title" name="legendTitle" type="text"></label>
        <label v-if="canFollow" class="gis-ui-editor-check"><input v-model="draft.useLayerStyle" name="followStyle" type="checkbox">{{ text('follow') }}</label>
        <p class="gis-ui-editor-hint">{{ draft.type === 'image' ? text('image') : text('presentation') }}</p>
        <div v-for="(item, index) in draft.items" :key="item.id" class="gis-ui-legend-editor-item">
          <label :for="`${fieldId}-item-${index}`">{{ text('item') }}<input :id="`${fieldId}-item-${index}`" v-model="item.label" :name="`itemLabel-${index}`" type="text"></label>
          <label :for="`${fieldId}-color-${index}`">{{ text('color') }}<span class="gis-ui-color-field"><i :style="{ background: itemColor(item) }" /><input :id="`${fieldId}-color-${index}`" :value="itemColor(item)" :disabled="canFollow && draft.useLayerStyle" :name="`itemColor-${index}`" type="text" @input="item.color = ($event.target as HTMLInputElement).value"></span></label>
          <div v-if="draft.items.length > 1" class="gis-ui-editor-item-order">
            <button type="button" :disabled="index === 0" :aria-label="`${text('up')} ${item.label}`" @click="move(index, -1)"><SvgIcon name="chevron-up" :size="14" /></button>
            <button type="button" :disabled="index === draft.items.length - 1" :aria-label="`${text('down')} ${item.label}`" @click="move(index, 1)"><SvgIcon name="chevron-down" :size="14" /></button>
          </div>
        </div>
        <div v-for="(stop, index) in draft.stops" :key="index" class="gis-ui-legend-editor-item">
          <label :for="`${fieldId}-stop-${index}`">{{ stop.value }}<input :id="`${fieldId}-stop-${index}`" v-model="stop.label" :name="`stopLabel-${index}`" type="text" :placeholder="String(stop.value)"></label>
          <label :for="`${fieldId}-stop-color-${index}`">{{ text('color') }}<input :id="`${fieldId}-stop-color-${index}`" v-model="stop.color" :name="`stopColor-${index}`" type="text"></label>
        </div>
        <label v-if="draft.noData" :for="`${fieldId}-no-data`">{{ text('noData') }}<input :id="`${fieldId}-no-data`" v-model="draft.noData.label" name="noDataLabel" type="text"></label>
      </template>
    </fieldset>
    <div class="gis-ui-editor-actions"><button type="button" :disabled="saving" @click="emit('cancel')">{{ text('cancel') }}</button><button type="submit" class="is-primary" :disabled="saving">{{ text('apply') }}</button></div>
  </form>
</template>
