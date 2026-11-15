<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LayerInstance, LayerTimeDimension } from '@joinmap/gis-core'
import GisSelect from '../components/GisSelect.vue'
import SvgIcon from '../components/SvgIcon.vue'
import TimeController from './TimeController.vue'
import { useAppState } from '../use-app-state.js'
import { useGISUI } from '../use-gis-ui.js'

interface DimensionOption {
  key: string
  layer: LayerInstance
  dimension: LayerTimeDimension
  label: string
}

const ui = useGISUI()
const snapshot = useAppState()
const selectedKey = ref('')
const current = ref(0)
const allTime = ref(false)

const dimensions = computed<DimensionOption[]>(() => {
  snapshot.value.revision
  return ui.app.layers.list().flatMap(layer => layer.getTimeDimensions().map(dimension => ({
    key: `${layer.id}\u0000${dimension.field}`,
    layer,
    dimension,
    label: `${layer.title ?? layer.id} · ${dimension.field}`,
  }))).filter(option => option.dimension.values.length > 0)
})
const options = computed(() => dimensions.value.map(option => ({ value: option.key, label: option.label })))
const selected = computed(() => dimensions.value.find(option => option.key === selectedKey.value))
const signature = computed(() => dimensions.value.map(option => {
  const filter = option.layer.getTimeFilter()
  return `${option.key}:${option.dimension.values.join(',')}:${filter?.field ?? ''}:${filter?.start ?? ''}:${filter?.end ?? ''}`
}).join('|'))

watch(selectedKey, () => { allTime.value = false })
watch([signature, selectedKey], () => {
  const available = dimensions.value
  if (!available.length) { selectedKey.value = ''; current.value = 0; return }
  let option = available.find(item => item.key === selectedKey.value)
  if (!option) {
    option = available.find(item => item.layer.getTimeFilter()?.field === item.dimension.field) ?? available[0]
    allTime.value = false
    selectedKey.value = option!.key
    return
  }
  const filter = option.layer.getTimeFilter()
  if (!filter && allTime.value) { current.value = option.dimension.values.at(-1)!; return }
  const value = filter?.field === option.dimension.field && filter.start === filter.end && option.dimension.values.includes(filter.start)
    ? filter.start
    : option.dimension.values.at(-1)!
  current.value = value
  apply(value)
}, { immediate: true })

function apply(value: number) {
  const option = selected.value
  if (!option) return
  allTime.value = false
  current.value = value
  const previous = option.layer.getTimeFilter()
  if (previous?.field === option.dimension.field && previous.start === value && previous.end === value) return
  option.layer.setTimeFilter({ field: option.dimension.field, start: value, end: value })
}

function clear() {
  const option = selected.value
  if (!option) return
  allTime.value = true
  option.layer.setTimeFilter(undefined)
}

function format(value: number): string {
  const locale = ui.locale.get() === 'zh' ? 'zh-CN' : 'en-US'
  const hasTime = selected.value?.dimension.values.some(item => item % 86_400_000 !== 0) ?? false
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    ...(hasTime ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : {}),
    hour12: false, timeZone: 'UTC',
  }).format(value)
}
</script>

<template>
  <div v-if="selected" class="gis-ui-layer-time">
    <SvgIcon class="gis-ui-layer-time-icon" name="calendar" :size="17" />
    <GisSelect v-if="options.length > 1" v-model="selectedKey" class="gis-ui-time-dimension"
      :options="options" :label="ui.locale.t('time.dimension')" />
    <span v-else class="gis-ui-time-dimension-label" :title="selected.label">{{ selected.label }}</span>
    <TimeController :model-value="current" :values="selected.dimension.values" :label="ui.locale.t('time.timeline')"
      :previous-label="ui.locale.t('time.previous')" :next-label="ui.locale.t('time.next')" :format-value="format"
      @update:model-value="apply" />
    <button type="button" class="gis-ui-time-clear" :class="{ 'is-active': allTime }" :disabled="allTime"
      :aria-label="ui.locale.t('time.all')" :title="ui.locale.t('time.all')" @click="clear">
      <SvgIcon name="clear" :size="14" />
    </button>
  </div>
  <button v-else type="button" class="gis-ui-time-placeholder" disabled :aria-label="ui.locale.t('time.empty')" :title="ui.locale.t('time.empty')">
    <SvgIcon name="calendar" :size="17" />
    <span>{{ ui.locale.t('time.empty') }}</span>
  </button>
</template>
