<script setup lang="ts">
import ScrollArea from './ScrollArea.vue';
defineProps<{
  title?: string;
  icon?: string;
  collapsed: boolean;
  collapsible: boolean;
  closable: boolean;
  keepMounted?: boolean;
  labels?: { expand: string; collapse: string; close: string };
}>();

const emit = defineEmits<{
  collapse: [];
  close: [];
}>();
</script>

<template>
  <article class="gis-ui-panel-shell" :class="{ 'is-collapsed': collapsed }">
    <header class="gis-ui-panel-header">
      <div class="gis-ui-panel-title">
        <slot name="title"
          ><span v-if="icon" aria-hidden="true">{{ icon }}</span> {{ title }}</slot
        >
      </div>
      <div class="gis-ui-panel-actions">
        <slot name="actions" />
        <button
          v-if="collapsible"
          type="button"
          :aria-expanded="!collapsed"
          @click="emit('collapse')"
        >
          {{ collapsed ? (labels?.expand ?? 'Expand') : (labels?.collapse ?? 'Collapse') }}
        </button>
        <button
          v-if="closable"
          type="button"
          class="gis-ui-panel-close"
          :aria-label="labels?.close ?? 'Close panel'"
          @click="emit('close')"
        >
          ×
        </button>
      </div>
    </header>
    <ScrollArea
      v-if="!collapsed || keepMounted"
      v-show="!collapsed"
      class="gis-ui-panel-body"
      :label="title"
      ><slot
    /></ScrollArea>
    <footer v-if="$slots.footer && !collapsed" class="gis-ui-panel-footer">
      <slot name="footer" />
    </footer>
  </article>
</template>
