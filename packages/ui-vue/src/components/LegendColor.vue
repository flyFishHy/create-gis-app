<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ modelValue: string; label: string; symbol?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const picker = computed(() => /^#[\da-f]{6}/i.exec(props.modelValue)?.[0] ?? '#3399cc')
</script>
<template>
  <label
    class="gis-ui-legend-color"
    :class="`symbol-${symbol ?? 'fill'}`"
    :title="label"
    :style="{ '--legend-color': modelValue }"
  >
    <input
      type="color"
      :value="picker"
      :aria-label="label"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
  </label>
</template>
