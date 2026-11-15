<script setup lang="ts">
import { computed } from 'vue'
import SvgIcon from '../components/SvgIcon.vue'

const props = withDefaults(defineProps<{
  modelValue: number
  values?: readonly number[]
  min?: number
  max?: number
  step?: number
  label?: string
  previousLabel?: string
  nextLabel?: string
  disabled?: boolean
  formatValue?: (value: number) => string
}>(), { step: 1, label: 'Time', previousLabel: 'Previous time', nextLabel: 'Next time', values: () => [] })

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
const discrete = computed(() => props.values.length > 0)
const index = computed(() => discrete.value ? Math.max(0, props.values.indexOf(props.modelValue)) : 0)
const rangeMin = computed(() => discrete.value ? 0 : props.min ?? 0)
const rangeMax = computed(() => discrete.value ? props.values.length - 1 : props.max ?? 100)
const rangeValue = computed(() => discrete.value ? index.value : props.modelValue)
const output = computed(() => props.formatValue?.(props.modelValue) ?? String(props.modelValue))

function input(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  emit('update:modelValue', discrete.value ? props.values[value] ?? props.modelValue : value)
}
function move(offset: number) {
  if (!discrete.value) return
  const next = Math.min(props.values.length - 1, Math.max(0, index.value + offset))
  emit('update:modelValue', props.values[next] ?? props.modelValue)
}
</script>

<template>
  <div class="gis-ui-time-controller">
    <button v-if="discrete" type="button" class="gis-ui-time-step" :aria-label="previousLabel" :title="previousLabel"
      :disabled="disabled || index <= 0" @click="move(-1)"><SvgIcon name="chevron-down" :size="14" /></button>
    <label class="gis-ui-time-range">
      <span class="gis-ui-sr-only">{{ label }}</span>
      <input type="range" :min="rangeMin" :max="rangeMax" :step="discrete ? 1 : step" :value="rangeValue" :disabled="disabled" @input="input">
    </label>
    <button v-if="discrete" type="button" class="gis-ui-time-step" :aria-label="nextLabel" :title="nextLabel"
      :disabled="disabled || index >= values.length - 1" @click="move(1)"><SvgIcon name="chevron-down" :size="14" /></button>
    <output :title="output">{{ output }}</output>
  </div>
</template>
