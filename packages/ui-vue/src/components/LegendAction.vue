<script setup lang="ts">
import SvgIcon from './SvgIcon.vue'
import Tooltip from './Tooltip.vue'
defineOptions({ inheritAttrs: false })
withDefaults(
  defineProps<{
    icon: string
    label: string
    type?: 'button' | 'submit'
    disabled?: boolean
    primary?: boolean
  }>(),
  { type: 'button' }
)
defineEmits<{ click: [event: MouseEvent] }>()
</script>
<template>
  <Tooltip :content="label" placement="bottom"
    ><button
      v-bind="$attrs"
      :type="type"
      :disabled="disabled"
      :aria-label="label"
      class="gis-ui-legend-action"
      :class="{ 'is-primary': primary }"
      @click="$emit('click', $event)"
    >
      <SvgIcon :name="icon" :size="14" /></button
  ></Tooltip>
</template>
