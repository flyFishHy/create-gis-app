<script setup lang="ts">
import SvgIcon from './SvgIcon.vue'
defineProps<{ icon: string; title: string; description?: string }>()
</script>
<template>
  <div class="gis-ui-panel-empty" role="status">
    <span class="gis-ui-panel-empty-icon"><SvgIcon :name="icon" :size="24" /></span>
    <h3>{{ title }}</h3>
    <p v-if="description">{{ description }}</p>
  </div>
</template>
