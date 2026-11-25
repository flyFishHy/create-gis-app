<script setup lang="ts">
import { computed } from 'vue';
import type { LayerStyle } from '@joinmap/gis-core';

const props = defineProps<{ color?: string; symbol?: string; layerStyle?: LayerStyle }>();
const width = computed(() => props.layerStyle?.strokeWidth ?? 2);
const dash = computed(() =>
  props.layerStyle?.lineDash === 'dashed'
    ? '6 4'
    : props.layerStyle?.lineDash === 'dotted'
      ? '1 3'
      : undefined
);
</script>

<template>
  <svg class="gis-ui-legend-swatch" viewBox="0 0 24 16" aria-hidden="true">
    <line
      v-if="symbol === 'line'"
      x1="3"
      y1="8"
      x2="21"
      y2="8"
      :stroke="color ?? layerStyle?.strokeColor ?? 'currentColor'"
      :stroke-width="Math.min(width, 5)"
      :stroke-dasharray="dash"
      :stroke-linecap="layerStyle?.lineCap ?? 'round'"
    />
    <circle
      v-else-if="symbol === 'circle'"
      cx="12"
      cy="8"
      :r="Math.min(6, Math.max(3, layerStyle?.pointRadius ?? 5))"
      :fill="color ?? layerStyle?.fillColor ?? 'currentColor'"
      :fill-opacity="layerStyle?.fillOpacity"
      :stroke="layerStyle?.strokeColor"
      :stroke-width="Math.min(width, 2)"
    />
    <rect
      v-else
      x="6"
      y="2"
      width="12"
      height="12"
      :rx="symbol === 'square' ? 0 : 1.5"
      :fill="color ?? layerStyle?.fillColor ?? 'currentColor'"
      :fill-opacity="layerStyle?.fillOpacity"
      :stroke="layerStyle?.strokeColor"
      :stroke-width="Math.min(width, 2)"
      :stroke-dasharray="dash"
    />
  </svg>
</template>
