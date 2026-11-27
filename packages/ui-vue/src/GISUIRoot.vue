<script setup lang="ts">
import { computed, provide } from 'vue';
import type { Component, ShallowRef } from 'vue';
import type { GISApp } from '@joinmap/gis-core';
import type { GISUIContext } from './types.js';
import { regionWidth } from './panels/panel-size.js';
import { GISAppKey } from './injection.js';
import { GISUIContextKey, DockedPanelMotionKey } from './ui-context.js';
import MapViewport from './components/MapViewport.vue';
import FeaturePicker from './components/FeaturePicker.vue';
import WorkspaceBottom from './workspace/WorkspaceBottom.vue';
import PanelRegion from './components/PanelRegion.vue';
import DashboardAppearance from './components/DashboardAppearance.vue';
import PanelHost from './components/PanelHost.vue';
import DashboardLayout from './layouts/DashboardLayout.vue';
import type { BuiltinLayoutName } from './types.js';
import { routePanels } from './layouts/layout-regions.js';
import { useWorkspaceTheme } from './workspace/use-workspace-theme.js';
import { useWorkspaceShortcuts } from './workspace/use-workspace-shortcuts.js';

const props = defineProps<{
  runtime: GISApp;
  ui: GISUIContext;
  activeLayout: Readonly<ShallowRef<string>>;
  customLayout?: Component;
  changeLayout?: (layout: BuiltinLayoutName) => void;
  workspaceStorageKey?: string;
  appProps: Record<string, unknown>;
}>();

provide(GISAppKey, props.runtime);
provide(GISUIContextKey, props.ui);
const layout = computed(() => (props.customLayout ? undefined : props.activeLayout.value));
provide(
  DockedPanelMotionKey,
  computed(() => layout.value === 'docked-dashboard')
);
const panels = computed(() => routePanels(props.ui.panels, layout.value));
const panelIds = computed(() => ({
  top: panels.value.top.map(({ id }) => id),
  left: panels.value.left.map(({ id }) => id),
  right: panels.value.right.map(({ id }) => id),
  bottom: panels.value.bottom.map(({ id }) => id),
  floating: panels.value.floating.map(({ id }) => id),
}));
const layoutProps = computed(() => ({
  ...props.appProps,
  ...(layout.value === 'docked-dashboard'
    ? { layout: layout.value, rightVisible: panels.value.right.some(({ visible }) => visible) }
    : layout.value === 'overlay-dashboard'
      ? { layout: layout.value, drawerVisible: panels.value.drawer.some(({ visible }) => visible) }
      : {}),
}));

const { themeClasses, mapStyle, panelStyle, themeStyle } = useWorkspaceTheme(
  props.ui.theme,
  layout
);
const regionStyle = computed(() => ({
  '--gis-ui-configured-left-width': regionWidth(panels.value.left),
  '--gis-ui-configured-right-width': regionWidth(panels.value.right),
  '--gis-ui-configured-drawer-width': regionWidth(panels.value.drawer, true),
}));
const appTitle = computed(() => props.runtime.config?.title);

const handleKeydown = useWorkspaceShortcuts(props.runtime);
</script>

<template>
  <component
    :is="customLayout ?? DashboardLayout"
    v-bind="layoutProps"
    class="gis-ui-root"
    :class="themeClasses"
    :style="[themeStyle, regionStyle]"
    :data-gis-ui-panel-style="panelStyle"
    @keydown="handleKeydown"
  >
    <template #title>
      <div class="gis-ui-brand">
        <span class="gis-ui-brand-mark" aria-hidden="true">{{ appTitle?.icon || 'G' }}</span>
        <strong>{{ appTitle?.content || runtime.name || ui.locale.t('app.workspace') }}</strong>
        <span v-if="appTitle?.subtitle?.trim()" class="gis-ui-brand-subtitle"
          ><span>{{ appTitle.subtitle }}</span></span
        >
      </div>
      <div class="gis-ui-header-actions">
        <DashboardAppearance
          :panel-style="panelStyle"
          :layout="layout"
          :change-layout="changeLayout"
          :workspace-storage-key="workspaceStorageKey"
        />
      </div>
    </template>
    <template #map><MapViewport :style="mapStyle" /><FeaturePicker /></template>
    <template #top>
      <div class="gis-ui-query-controls">
        <PanelRegion position="top" :panel-ids="panelIds.top" />
      </div>
    </template>
    <template #toolbar>
      <PanelHost v-for="{ id } in panels.toolbar" :key="id" :id="id" />
    </template>
    <template #left><PanelRegion position="left" :panel-ids="panelIds.left" /></template>
    <template #right><PanelRegion position="right" :panel-ids="panelIds.right" /></template>
    <template #drawer>
      <PanelHost v-for="{ id } in panels.drawer" :key="id" :id="id" animate />
    </template>
    <template #bottom>
      <WorkspaceBottom :panel-ids="panelIds.bottom" :status-panels="panels.status" />
    </template>
    <template #floating>
      <PanelRegion position="floating" :panel-ids="panelIds.floating" />
    </template>
  </component>
</template>
