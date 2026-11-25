<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { FeatureReference } from '@joinmap/gis-core';
import { useGISApp } from '../use-gis-app.js';
import { useGISUI } from '../use-gis-ui.js';
import FeatureDetails from '../components/FeatureDetails.vue';

const app = useGISApp();
const ui = useGISUI();
const feature = ref<FeatureReference>();
let unsubscribe: (() => void) | undefined;

onMounted(() => {
  feature.value = app.interactions.getSelection();
  unsubscribe = app.interactions.onSelect((selection) => {
    feature.value = selection;
  });
});
onBeforeUnmount(() => unsubscribe?.());
</script>

<template>
  <aside v-if="feature" class="gis-ui-feature-popup" aria-live="polite">
    <header>
      <strong>{{ ui.locale.t('panel.properties') }}</strong>
      <button
        type="button"
        :aria-label="ui.locale.t('action.clearSelection')"
        @click="app.interactions.clearSelection()"
      >
        ×
      </button>
    </header>
    <FeatureDetails :feature="feature" />
  </aside>
</template>
