<script setup lang="ts">
import { computed, onBeforeUnmount, provide, shallowRef } from 'vue';
import type { Component, CSSProperties, ShallowRef } from 'vue';
import { GISRuntimeError, type GISApp } from '@joinmap/gis-core';
import type { GISUIContext } from './types.js';
import { regionWidth, cssSize } from './panels/panel-size.js';
import { GISAppKey } from './injection.js';
import { GISUIContextKey, DockedPanelMotionKey } from './ui-context.js';
import MapViewport from './components/MapViewport.vue';
import FeaturePicker from './components/FeaturePicker.vue';
import ToolHint from './components/ToolHint.vue';
import PanelRegion from './components/PanelRegion.vue';
import DashboardAppearance from './components/DashboardAppearance.vue';
import PanelHost from './components/PanelHost.vue';
import DashboardLayout from './layouts/DashboardLayout.vue';
import type { BuiltinLayoutName, ThemeOptions, ThemeTokens } from './types.js';

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
const hasRightPanels = computed(() =>
  props.ui.panels.list('right').some((panel) => props.ui.panels.getState(panel.id)?.visible)
);
const drawerVisible = computed(() =>
  props.ui.panels
    .list('right')
    .some((panel) => panel.id === 'properties' && props.ui.panels.getState(panel.id)?.visible)
);
const layoutProps = computed(() => ({
  ...props.appProps,
  ...(layout.value === 'docked-dashboard'
    ? { layout: layout.value, rightVisible: hasRightPanels.value }
    : layout.value === 'overlay-dashboard'
      ? { layout: layout.value, drawerVisible: drawerVisible.value }
      : {}),
}));

const theme = shallowRef<Readonly<ThemeOptions>>(props.ui.theme.get());
const unsubscribeTheme = props.ui.theme.subscribe((next) => {
  theme.value = next;
});
onBeforeUnmount(unsubscribeTheme);

const themeClasses = computed(() => [
  `gis-ui-theme-${theme.value.mode ?? 'light'}`,
  theme.value.className,
]);
const mapStyle = computed(() => ({
  '--gis-map-measurement-color': theme.value.tokens?.colorPrimary ?? 'var(--gis-ui-primary)',
}));
const panelStyle = computed(() => {
  const style = theme.value.tokens?.panelStyle;
  if (style === 'frosted' || style === 'liquid' || style === 'solid') {
    return style;
  }
  return layout.value === 'docked-dashboard' ? 'solid' : 'frosted';
});

function primaryForeground(color: string | undefined) {
  const hex = color?.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (!hex) {
    return undefined;
  }
  const size = hex.length / 3;
  const channels = [0, size, size * 2].map((index) => {
    const part = hex.slice(index, index + size);
    const value = Number.parseInt(size === 1 ? part.repeat(2) : part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return luminance > 0.179 ? '#000' : '#fff';
}

const themeStyle = computed<CSSProperties>(() => {
  const variables: Partial<Record<keyof ThemeTokens, string>> = {
    colorBackground: '--gis-ui-background',
    colorSurface: '--gis-ui-surface',
    colorSurfaceElevated: '--gis-ui-surface-elevated',
    colorText: '--gis-ui-text',
    colorTextMuted: '--gis-ui-text-muted',
    colorBorder: '--gis-ui-border',
    colorPrimary: '--gis-ui-primary',
    colorHover: '--gis-ui-hover',
    colorSuccess: '--gis-ui-success',
    colorDanger: '--gis-ui-danger',
    panelRadius: '--gis-ui-panel-radius',
    panelShadow: '--gis-ui-panel-shadow',
    panelOpacity: '--gis-ui-glass-opacity',
    panelBlur: '--gis-ui-glass-blur',
    panelSpecular: '--gis-ui-liquid-specular',
    panelWidth: '--gis-ui-panel-width',
    leftPanelWidth: '--gis-ui-left-width',
    rightPanelWidth: '--gis-ui-right-width',
    overlayPanelWidth: '--gis-ui-overlay-panel-width',
    toolbarHeight: '--gis-ui-toolbar-height',
    spacingUnit: '--gis-ui-gap',
    fontFamily: '--gis-ui-font-family',
    fontSize: '--gis-ui-font-size',
  };
  const tokens = theme.value.tokens ?? {};
  const style = Object.fromEntries(
    Object.entries(tokens)
      .filter(([key, value]) => Object.hasOwn(variables, key) && typeof value === 'string')
      .map(([key, value]) => [variables[key as keyof ThemeTokens], value])
  ) as CSSProperties;
  if (tokens.colorBackground) {
    style['--gis-ui-map-background'] = tokens.colorBackground;
  }
  const foreground = primaryForeground(tokens.colorPrimary);
  if (foreground) {
    style['--gis-ui-on-primary'] = foreground;
    style['--gis-ui-primary-hover-tint'] = foreground === '#fff' ? '#000' : '#fff';
  }
  return style;
});
const regionStyle = computed(() => ({
  '--gis-ui-configured-left-width': regionWidth(props.ui.panels, 'left'),
  '--gis-ui-configured-right-width': regionWidth(
    props.ui.panels,
    'right',
    layout.value === 'overlay-dashboard' ? ['properties'] : []
  ),
  '--gis-ui-configured-drawer-width': cssSize(props.ui.panels.getState('properties')?.width),
}));
const appTitle = computed(() => props.runtime.config?.title);

function handleKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.matches('input,textarea,select') || target.isContentEditable)
  ) {
    return;
  }
  try {
    if (event.key === 'Escape') {
      void props.runtime.interactions.deactivateTool().catch(reportToolError);
    }
    if (event.key === 'Backspace' && props.runtime.interactions.getActiveTool()) {
      event.preventDefault();
      props.runtime.interactions.undoActiveTool();
    }
  } catch (cause) {
    reportToolError(cause);
  }
}
function reportToolError(cause: unknown) {
  props.runtime.events.emit('app:error', {
    error: new GISRuntimeError({
      code: 'APP_INVALID_STATE',
      message: 'Tool shortcut failed.',
      cause,
    }),
  });
}
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
        <PanelRegion position="top" />
      </div>
    </template>
    <template #toolbar>
      <PanelHost id="toolbar" />
    </template>
    <template #left><PanelRegion position="left" /></template>
    <template #right
      ><PanelRegion
        position="right"
        :exclude="layout === 'overlay-dashboard' ? ['properties'] : undefined"
    /></template>
    <template #drawer
      ><PanelHost
        v-if="
          layout === 'overlay-dashboard' && ui.panels.getState('properties')?.position === 'right'
        "
        id="properties"
        animate
    /></template>
    <template #bottom>
      <div class="gis-ui-bottom-content">
        <PanelRegion position="bottom" />
        <ToolHint />
        <div v-if="ui.panels.getState('status')?.visible" class="gis-ui-status-content">
          <PanelHost id="status" />
        </div>
      </div>
    </template>
    <template #floating>
      <PanelRegion position="floating" />
    </template>
  </component>
</template>
