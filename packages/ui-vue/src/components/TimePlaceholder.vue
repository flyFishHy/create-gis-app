<script setup lang="ts">
import SvgIcon from './SvgIcon.vue'
import { useGISUI } from '../use-gis-ui.js'
const ui = useGISUI()
</script>

<template>
  <button type="button" class="gis-ui-time-placeholder" disabled :aria-label="ui.locale.t('time.placeholder')" :title="ui.locale.t('time.placeholder')">
    <SvgIcon name="calendar" :size="17" />
    <span>{{ ui.locale.t('time.placeholder') }}</span>
  </button>
</template>
