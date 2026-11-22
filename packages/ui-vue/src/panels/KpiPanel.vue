<script setup lang="ts">
import type { KpiItem } from '../types.js'

withDefaults(defineProps<{ items: readonly KpiItem[] }>(), { items: () => [] })
</script>

<template>
  <div class="gis-ui-kpi-grid">
    <article v-for="item in items" :key="item.id" class="gis-ui-kpi-card">
      <span class="gis-ui-kpi-label">{{ item.label }}</span>
      <strong
        >{{ item.value }}<small v-if="item.unit"> {{ item.unit }}</small></strong
      >
      <span v-if="item.hint" class="gis-ui-kpi-hint">{{ item.hint }}</span>
    </article>
  </div>
</template>
