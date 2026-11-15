<script setup lang="ts">
import { computed } from 'vue'
import { useAppState } from '../use-app-state.js'
import { useGISUI } from '../use-gis-ui.js'
import Legend from '../components/Legend.vue'
const snapshot = useAppState()
const ui = useGISUI()
const layers = computed(() => snapshot.value.layers.filter(layer => layer.visible && layer.legend))
const definitions = computed(() => layers.value.flatMap(layer => layer.legend ? [layer.legend] : []))
const titles = computed(() => Object.fromEntries(layers.value.map(layer => [layer.id, layer.title ?? layer.legend?.title ?? layer.id])))
</script>
<template><Legend :definitions="definitions" :titles="titles" :empty-text="ui.locale.t('legend.empty')" /></template>
