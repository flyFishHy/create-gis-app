<script setup lang="ts">
withDefaults(defineProps<{
  modelValue: number
  min: number
  max: number
  step?: number
  label?: string
}>(), { step: 1, label: 'Time' })

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
</script>

<template>
  <label class="gis-ui-time-controller">
    <span>{{ label }}</span>
    <input type="range" :min="min" :max="max" :step="step" :value="modelValue" @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))">
    <output>{{ modelValue }}</output>
  </label>
</template>
