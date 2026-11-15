<script setup lang="ts">
import { computed, onBeforeUnmount, provide, shallowRef } from 'vue'
import type { Component, CSSProperties } from 'vue'
import { GISRuntimeError, type GISApp } from '@joinmap/gis-core'
import type { GISUIContext } from './types.js'
import { regionWidth } from './panels/panel-size.js'
import { GISAppKey } from './injection.js'
import { GISUIContextKey, DockedPanelMotionKey } from './ui-context.js'
import MapViewport from './components/MapViewport.vue'
import PanelRegion from './components/PanelRegion.vue'
import GisSwitch from './components/GisSwitch.vue'
import PanelHost from './components/PanelHost.vue'
import DockedDashboardLayout from './layouts/DockedDashboardLayout.vue'
import OverlayDashboardLayout from './layouts/OverlayDashboardLayout.vue'
import type { BuiltinLayoutName } from './types.js'
import type { GisSwitchOption, ThemeOptions, ThemeTokens } from './types.js'

const props = defineProps<{
  runtime: GISApp
  ui: GISUIContext
  layout: string | Component
  appProps: Record<string, unknown>
}>()

provide(GISAppKey, props.runtime)
provide(GISUIContextKey, props.ui)
provide(DockedPanelMotionKey, computed(() => props.layout === 'docked-dashboard'))
const hasRightPanels = computed(() => props.ui.panels.list('right').some(panel => props.ui.panels.getState(panel.id)?.visible))
const layoutProps = computed(() => ({ ...props.appProps, ...(props.layout === 'docked-dashboard' ? { rightVisible: hasRightPanels.value } : {}) }))

const theme = shallowRef<Readonly<ThemeOptions>>(props.ui.theme.get())
const unsubscribeTheme = props.ui.theme.subscribe((next) => { theme.value = next })
onBeforeUnmount(unsubscribeTheme)

const layoutComponent = computed(() => {
  if (props.layout === 'overlay-dashboard') return OverlayDashboardLayout
  if (props.layout === 'docked-dashboard') return DockedDashboardLayout
  return props.layout
})

const themeClasses = computed(() => [
  `gis-ui-theme-${theme.value.mode ?? 'light'}`,
  theme.value.className,
])

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
    panelWidth: '--gis-ui-panel-width',
    leftPanelWidth: '--gis-ui-left-width',
    rightPanelWidth: '--gis-ui-right-width',
    overlayPanelWidth: '--gis-ui-overlay-panel-width',
    toolbarHeight: '--gis-ui-toolbar-height',
    spacingUnit: '--gis-ui-gap',
    fontFamily: '--gis-ui-font-family',
    fontSize: '--gis-ui-font-size',
  }
  return Object.fromEntries(Object.entries(theme.value.tokens ?? {})
    .filter(([key, value]) => key in variables && typeof value === 'string')
    .map(([key, value]) => [variables[key as keyof ThemeTokens], value])) as CSSProperties
})
const regionStyle = computed(() => ({
  '--gis-ui-configured-left-width': regionWidth(props.ui.panels, 'left'),
  '--gis-ui-configured-right-width': regionWidth(props.ui.panels, 'right'),
}))
const appTitle = computed(() => {
  const value = props.runtime.config?.title
  return value && typeof value === 'object' ? value as { content?: string; icon?: string } : undefined
})

type ThemeMode = 'light' | 'dark'
const systemTheme = typeof window === 'undefined' ? undefined : window.matchMedia?.('(prefers-color-scheme: dark)')
const systemDark = shallowRef(systemTheme?.matches ?? false)
const updateSystemTheme = (event: MediaQueryListEvent) => { systemDark.value = event.matches }
systemTheme?.addEventListener('change', updateSystemTheme)
onBeforeUnmount(() => systemTheme?.removeEventListener('change', updateSystemTheme))

const themeMode = computed<ThemeMode>(() => {
  const mode = theme.value.mode
  return mode === 'dark' || (mode === 'system' && systemDark.value) ? 'dark' : 'light'
})

const themeOptions = computed<readonly GisSwitchOption[]>(() => [
  { value: 'light', icon: 'sun', label: props.ui.locale.t('theme.light'), ariaLabel: 'Light' },
  { value: 'dark', icon: 'moon', label: props.ui.locale.t('theme.dark'), ariaLabel: 'Dark' },
])

const languageOptions: readonly GisSwitchOption[] = [
  { value: 'zh', label: '中文', ariaLabel: 'Chinese' },
  { value: 'en', label: 'EN', ariaLabel: 'English' },
]

function setThemeMode(mode: string) {
  if (mode === 'light' || mode === 'dark') {
    props.ui.theme.set({ mode })
  }
}

function setLocale(locale: string) {
  if (locale === 'zh' || locale === 'en') {
    props.ui.locale.set(locale)
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
  const target = event.target
  if (target instanceof HTMLElement && (target.matches('input,textarea,select') || target.isContentEditable)) return
  try {
    if (event.key === 'Escape') void props.runtime.interactions.deactivateTool().catch(reportToolError)
    if (event.key === 'Backspace' && props.runtime.interactions.getActiveTool()) { event.preventDefault(); props.runtime.interactions.undoActiveTool() }
  } catch (cause) { reportToolError(cause) }
}
function reportToolError(cause: unknown) {
  props.runtime.events.emit('app:error', { error: new GISRuntimeError({ code: 'APP_INVALID_STATE', message: 'Tool shortcut failed.', cause }) })
}
</script>

<template>
  <component :is="layoutComponent" v-bind="layoutProps" class="gis-ui-root" :class="themeClasses" :style="[themeStyle, regionStyle]" @keydown="handleKeydown">
    <template #title>
      <div class="gis-ui-brand">
        <span class="gis-ui-brand-mark" aria-hidden="true">{{ appTitle?.icon || 'G' }}</span>
        <strong>{{ appTitle?.content || runtime.name || ui.locale.t('app.workspace') }}</strong>
      </div>
      <div class="gis-ui-header-actions">
        <GisSwitch class="gis-ui-switch--theme" :model-value="themeMode" :options="themeOptions" group-label="Theme" @update:model-value="setThemeMode" />
        <GisSwitch :model-value="ui.locale.get()" :options="languageOptions" group-label="Language" @update:model-value="setLocale" />
      </div>
    </template>
    <template #map><MapViewport /></template>
    <template #top>
      <div class="gis-ui-query-controls">
        <PanelRegion position="top" />
      </div>
    </template>
    <template #toolbar>
      <PanelHost id="toolbar" />
    </template>
    <template #left><PanelRegion position="left" /></template>
    <template #right><PanelRegion position="right" /></template>
    <template #bottom>
      <div class="gis-ui-bottom-content">
        <PanelRegion position="bottom" />
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
