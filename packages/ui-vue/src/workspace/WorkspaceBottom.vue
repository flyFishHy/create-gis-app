<script setup lang="ts">
import PanelHost from '../components/PanelHost.vue';
import PanelRegion from '../components/PanelRegion.vue';
import ToolHint from '../components/ToolHint.vue';
import type { PanelState } from '../types.js';

defineProps<{ panelIds: readonly string[]; statusPanels: readonly PanelState[] }>();
</script>

<template>
  <div class="gis-ui-bottom-content">
    <PanelRegion position="bottom" :panel-ids="panelIds" />
    <ToolHint />
    <div v-if="statusPanels.some((panel) => panel.visible)" class="gis-ui-status-content">
      <PanelHost v-for="{ id } in statusPanels" :key="id" :id="id" />
    </div>
  </div>
</template>
