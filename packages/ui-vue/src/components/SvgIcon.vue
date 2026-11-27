<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ name: string; size?: number; title?: string }>(), {
  size: 18,
});
const icons = import.meta.glob('../assets/svg/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;
const svg = computed(() => icons[`../assets/svg/${props.name}.svg`]);
</script>

<template>
  <slot v-if="!svg && $slots.default" />
  <span
    v-else
    class="gis-ui-svg-icon"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :role="title ? 'img' : undefined"
    :aria-label="title"
    :aria-hidden="!title"
    v-html="svg"
  />
</template>
