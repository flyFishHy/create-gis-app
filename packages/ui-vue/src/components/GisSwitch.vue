<script setup lang="ts">
import type { GisSwitchOption } from '../types.js'
import SvgIcon from './SvgIcon.vue'

withDefaults(defineProps<{
  modelValue: string
  options: readonly GisSwitchOption[]
  groupLabel?: string
}>(), { groupLabel: 'Switch' })

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

function select(value: string) {
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="gis-ui-switch" role="group" :aria-label="groupLabel">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :class="{ 'is-active': option.value === modelValue }"
      :aria-pressed="option.value === modelValue"
      :aria-label="option.ariaLabel ?? option.label ?? option.value"
      @click="select(option.value)"
    >
      <SvgIcon v-if="option.icon" :name="option.icon" :size="15" />
      <span v-if="option.label">{{ option.label }}</span>
    </button>
  </div>
</template>
