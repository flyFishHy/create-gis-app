<script setup lang="ts">
import { computed } from 'vue';
import { useAppState } from '../use-app-state.js';
import { useGISUI } from '../use-gis-ui.js';

const ui = useGISUI();
const snapshot = useAppState();
const hints: Record<string, string> = {
  'draw-point': 'tool.hint.draw-point',
  'draw-line': 'tool.hint.draw-line',
  'draw-polygon': 'tool.hint.draw-polygon',
  'measure-distance': 'tool.hint.measure-distance',
  'measure-area': 'tool.hint.measure-area',
  'measure-angle': 'tool.hint.measure-angle',
  'modify-result': 'tool.hint.modify-result',
};
const message = computed(() => {
  const id = snapshot.value.interactions.activeToolId;
  return id ? hints[id] : undefined;
});
</script>

<template>
  <Transition name="gis-ui-tool-hint">
    <div v-if="message" class="gis-ui-tool-hint" role="status" aria-live="polite">
      <span class="gis-ui-tool-hint-pulse" aria-hidden="true" />
      <span>{{ ui.locale.t(message) }}</span>
      <kbd>Esc</kbd>
    </div>
  </Transition>
</template>
