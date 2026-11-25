<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { GISApp } from '@joinmap/gis-core';
import { getVueUIAdapter } from './vue-ui.js';
import GISUIRoot from './GISUIRoot.vue';

const props = defineProps<{ app: GISApp }>();
const emit = defineEmits<{ ready: []; error: [cause: unknown] }>();
const adapter = getVueUIAdapter(props.app);
const visible = ref(false);
const target = ref<HTMLElement>();
const release = adapter.bindHost(
  (value) => {
    visible.value = value;
  },
  () => target.value
);
let stopped = false;
let mounting: Promise<void> | undefined;
onMounted(async () => {
  try {
    mounting = props.app.mount(target.value!);
    await mounting;
    if (!stopped) {
      emit('ready');
    }
  } catch (cause) {
    if (!stopped) {
      emit('error', cause);
    }
  }
});
onBeforeUnmount(() => {
  stopped = true;
  // Queue behind a possible mount; keep the host bound until Runtime has detached it.
  void (async () => {
    try {
      await mounting?.catch(() => {});
      if (props.app.status === 'mounted') {
        await props.app.unmount();
      }
    } finally {
      release();
    }
  })().catch((cause) => emit('error', cause));
});
</script>

<template>
  <div ref="target" class="gis-ui-workspace-host">
    <GISUIRoot v-if="visible" v-bind="adapter.rootProps" />
  </div>
</template>

<style scoped>
.gis-ui-workspace-host {
  width: 100%;
  height: 100%;
  min-height: 0;
}
</style>
