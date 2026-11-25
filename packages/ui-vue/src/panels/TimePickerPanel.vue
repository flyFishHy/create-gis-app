<script setup lang="ts">
import { computed, type ShallowRef } from 'vue';
import type { UITimePickerConfig } from '@joinmap/gis-core';
import TimeFilterPicker from '../components/time-picker/TimeFilterPicker.vue';
import type { TimeSelection } from '../components/time-picker/types.js';
import { useGISUI } from '../use-gis-ui.js';

const props = defineProps<{
  options?: UITimePickerConfig;
  selection: Readonly<ShallowRef<TimeSelection | null>>;
  setSelection: (selection: TimeSelection | null) => void;
}>();
const ui = useGISUI();
const value = computed({
  get: () => props.selection.value,
  set: (selection) => props.setSelection(selection),
});
</script>

<template>
  <TimeFilterPicker
    v-model="value"
    v-bind="options"
    :locale="ui.locale.get() === 'zh' ? 'zh-CN' : 'en'"
  />
</template>
