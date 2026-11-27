<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, useId, useTemplateRef, watch } from 'vue';
import type { CSSProperties } from 'vue';
import type { BuiltinLayoutName, GisSwitchOption, ThemeTokens } from '../types.js';
import { useGISUI } from '../use-gis-ui.js';
import GisSwitch from './GisSwitch.vue';
import SvgIcon from './SvgIcon.vue';
import { useWorkspaceTransfer } from '../workspace/use-workspace-transfer.js';

const props = defineProps<{
  panelStyle: NonNullable<ThemeTokens['panelStyle']>;
  layout?: string;
  changeLayout?: (layout: BuiltinLayoutName) => void;
  workspaceStorageKey?: string;
}>();
const { app, theme, locale } = useGISUI();
const trigger = useTemplateRef<HTMLButtonElement>('trigger');
const popoverId = `gis-ui-appearance-${encodeURIComponent(app.id)}-${useId()}`;
const titleId = `${popoverId}-title`;
const position = shallowRef<CSSProperties>();
const open = shallowRef(false);
const { workspaceError, importInput, exportWorkspace, importWorkspace } = useWorkspaceTransfer(
  app,
  locale,
  () => props.workspaceStorageKey
);
const tokens = computed(() => theme.get().tokens);
const systemTheme =
  typeof window === 'undefined' ? undefined : window.matchMedia?.('(prefers-color-scheme: dark)');
const systemDark = shallowRef(systemTheme?.matches ?? false);
const updateSystemTheme = (event: MediaQueryListEvent) => {
  systemDark.value = event.matches;
};
systemTheme?.addEventListener('change', updateSystemTheme);
onBeforeUnmount(() => systemTheme?.removeEventListener('change', updateSystemTheme));

const themeMode = computed(() => {
  const mode = theme.get().mode;
  return mode === 'dark' || (mode === 'system' && systemDark.value) ? 'dark' : 'light';
});
const themeOptions = computed<readonly GisSwitchOption[]>(() => [
  { value: 'light', icon: 'sun', label: locale.t('theme.light') },
  { value: 'dark', icon: 'moon', label: locale.t('theme.dark') },
]);
const layoutOptions = computed<readonly GisSwitchOption[]>(() => [
  { value: 'docked-dashboard', label: locale.t('appearance.docked') },
  { value: 'overlay-dashboard', label: locale.t('appearance.overlay') },
]);
const languageOptions: readonly GisSwitchOption[] = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
];
const styles = ['frosted', 'liquid', 'solid'] as const;
const styleOptions = computed<readonly GisSwitchOption[]>(() =>
  styles.map((value) => ({ value, label: locale.t(`appearance.${value}`) }))
);
const palette = [
  ['blue', '#3b82f6'],
  ['emerald', '#10b981'],
  ['violet', '#8b5cf6'],
  ['amber', '#f59e0b'],
  ['rose', '#ef4444'],
  ['cyan', '#06b6d4'],
] as const;
const primary = computed(() => tokens.value?.colorPrimary ?? palette[0][1]);
const pickerColor = computed(() => {
  const color = primary.value.toLowerCase();
  if (/^#[\da-f]{6}$/.test(color)) {
    return color;
  }
  if (/^#[\da-f]{3}$/.test(color)) {
    return color.replace(/[\da-f]/g, (channel) => channel.repeat(2));
  }
  return palette[0][1];
});
const showHex = computed(() => /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(primary.value));

type RangeToken = 'panelOpacity' | 'panelBlur' | 'panelSpecular';
interface SettingRange {
  key: RangeToken;
  label: string;
  min: number;
  max: number;
  initial: number;
  unit: '%' | 'px';
  disabled?: boolean;
}
const ranges = computed<SettingRange[]>(() => {
  const solid = props.panelStyle === 'solid';
  const controls: SettingRange[] = [
    {
      key: 'panelOpacity',
      label: 'appearance.opacity',
      min: solid ? 94 : 15,
      max: 100,
      initial: 72,
      unit: '%',
    },
    {
      key: 'panelBlur',
      label: 'appearance.blur',
      min: 0,
      max: 40,
      initial: 16,
      unit: 'px',
      disabled: solid,
    },
  ];
  if (props.panelStyle === 'liquid') {
    controls.push({
      key: 'panelSpecular',
      label: 'appearance.specular',
      min: 0,
      max: 100,
      initial: 35,
      unit: '%',
    });
  }
  return controls;
});

function rangeValue({ key, initial, min, max }: SettingRange) {
  const value = Number.parseFloat(tokens.value?.[key] ?? '');
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : initial));
}

function setStyle(value: string) {
  if (value === 'frosted' || value === 'liquid' || value === 'solid') {
    theme.set({ tokens: { panelStyle: value } });
  }
}

function setThemeMode(value: string) {
  if (value === 'light' || value === 'dark') {
    theme.set({ mode: value });
  }
}

function setLayout(value: string) {
  if (value === 'docked-dashboard' || value === 'overlay-dashboard') {
    props.changeLayout?.(value);
  }
}

function setLocale(value: string) {
  if (value === 'zh' || value === 'en') {
    locale.set(value);
  }
}

function updateRange({ key, unit }: SettingRange, event: Event) {
  const value = (event.target as HTMLInputElement).valueAsNumber;
  if (Number.isFinite(value)) {
    theme.set({ tokens: { [key]: `${value}${unit}` } });
  }
}

function setColor(color: string) {
  theme.set({ tokens: { colorPrimary: color } });
}

function placePopover(event?: Event) {
  if (event?.target instanceof Element && event.target.closest('.gis-ui-appearance')) {
    return;
  }
  const button = trigger.value;
  if (!button) {
    return;
  }
  const anchor = button.getBoundingClientRect();
  const header = button.closest('header')?.getBoundingClientRect() ?? anchor;
  const width = document.documentElement.clientWidth || window.innerWidth;
  const height = window.innerHeight;
  const margin = 12;
  const gap = 8;
  const below = height - header.bottom - gap - margin;
  const above = header.top - gap - margin;
  const openAbove = below < 280 && above > below;
  position.value = {
    right: `${Math.max(margin, Math.min(width - anchor.right, width - 410 - margin))}px`,
    top: openAbove ? 'auto' : `${Math.max(margin, header.bottom + gap)}px`,
    bottom: openAbove ? `${Math.max(margin, height - header.top + gap)}px` : 'auto',
    maxHeight: `${Math.max(0, openAbove ? above : below)}px`,
  };
}

function stopPositioning() {
  window.removeEventListener('resize', placePopover);
  window.removeEventListener('scroll', placePopover, true);
}

function beforeToggle(event: ToggleEvent) {
  open.value = event.newState === 'open';
  if (open.value) {
    placePopover();
    window.addEventListener('resize', placePopover);
    window.addEventListener('scroll', placePopover, true);
  } else {
    stopPositioning();
  }
}

onBeforeUnmount(stopPositioning);
watch(
  () => props.layout,
  () => {
    if (open.value) {
      placePopover();
    }
  },
  { flush: 'post' }
);
</script>

<template>
  <button
    ref="trigger"
    class="gis-ui-appearance-trigger"
    type="button"
    v-bind="{ popovertarget: popoverId }"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :aria-label="locale.t('appearance.settings')"
    :title="locale.t('appearance.settings')"
  >
    <SvgIcon name="settings" :size="17" />
  </button>
  <section
    :id="popoverId"
    class="gis-ui-appearance"
    v-bind="{ popover: 'auto' }"
    role="dialog"
    :aria-labelledby="titleId"
    :style="position"
    @beforetoggle="beforeToggle"
    @keydown.stop
  >
    <div class="gis-ui-appearance-heading">
      <span class="gis-ui-appearance-mark"><SvgIcon name="sliders-horizontal" :size="16" /></span>
      <h2 :id="titleId">{{ locale.t('appearance.title') }}</h2>
      <button
        type="button"
        class="gis-ui-icon-button"
        v-bind="{ popovertarget: popoverId, popovertargetaction: 'hide' }"
        :aria-label="locale.t('appearance.close')"
        autofocus
      >
        <SvgIcon name="close" :size="16" />
      </button>
    </div>
    <div class="gis-ui-appearance-content">
      <h3><SvgIcon name="palette" :size="15" />{{ locale.t('appearance.group') }}</h3>
      <div class="gis-ui-appearance-card">
        <div class="gis-ui-appearance-row">
          <span>{{ locale.t('appearance.themeMode') }}</span>
          <GisSwitch
            class="gis-ui-switch--theme"
            :model-value="themeMode"
            :options="themeOptions"
            :group-label="locale.t('appearance.themeMode')"
            @update:model-value="setThemeMode"
          />
        </div>
        <div class="gis-ui-appearance-block">
          <span>{{ locale.t('appearance.panelStyle') }}</span>
          <GisSwitch
            class="gis-ui-appearance-styles"
            :model-value="panelStyle"
            :options="styleOptions"
            :group-label="locale.t('appearance.panelStyle')"
            @update:model-value="setStyle"
          />
          <label
            v-for="range in ranges"
            :key="range.key"
            class="gis-ui-appearance-range"
            :class="{ 'is-disabled': range.disabled }"
          >
            <span>{{ locale.t(range.label) }}</span>
            <output aria-hidden="true">{{ rangeValue(range) }}{{ range.unit }}</output>
            <input
              type="range"
              :min="range.min"
              :max="range.max"
              :value="rangeValue(range)"
              :disabled="range.disabled"
              :aria-valuetext="`${rangeValue(range)}${range.unit}`"
              @input="updateRange(range, $event)"
            />
          </label>
        </div>
        <div class="gis-ui-appearance-block">
          <div class="gis-ui-appearance-accent">
            <span>{{ locale.t('appearance.primary') }}</span><output>{{
              showHex ? pickerColor.toUpperCase() : primary
            }}</output>
          </div>
          <div class="gis-ui-appearance-colors">
            <div
              class="gis-ui-appearance-swatches"
              role="group"
              :aria-label="locale.t('appearance.primary')"
            >
              <button
                v-for="[name, color] in palette"
                :key="name"
                type="button"
                :style="{ backgroundColor: color }"
                :aria-label="locale.t(`appearance.color.${name}`)"
                :title="locale.t(`appearance.color.${name}`)"
                :aria-pressed="showHex && pickerColor === color"
                @click="setColor(color)"
              />
            </div>
            <input
              type="color"
              :value="pickerColor"
              :aria-label="locale.t('appearance.customColor')"
              :title="locale.t('appearance.customColor')"
              @input="setColor(($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
        <div v-if="changeLayout && layout" class="gis-ui-appearance-block gis-ui-appearance-row">
          <span>{{ locale.t('appearance.layout') }}</span>
          <GisSwitch
            :model-value="layout"
            :options="layoutOptions"
            :group-label="locale.t('appearance.layout')"
            @update:model-value="setLayout"
          />
        </div>
      </div>
      <div class="gis-ui-appearance-language">
        <h3><SvgIcon name="global" :size="15" />{{ locale.t('appearance.language') }}</h3>
        <div class="gis-ui-appearance-card gis-ui-appearance-row">
          <span>{{ locale.t('appearance.displayLanguage') }}</span>
          <GisSwitch
            :model-value="locale.get()"
            :options="languageOptions"
            :group-label="locale.t('appearance.language')"
            @update:model-value="setLocale"
          />
        </div>
      </div>
      <div v-if="workspaceStorageKey" class="gis-ui-appearance-language">
        <h3><SvgIcon name="save" :size="15" />{{ locale.t('workspace.title') }}</h3>
        <div class="gis-ui-appearance-card gis-ui-workspace-actions">
          <button type="button" @click="exportWorkspace">{{ locale.t('workspace.export') }}</button>
          <button type="button" @click="importInput?.click()">
            {{ locale.t('workspace.import') }}
          </button>
          <input
            ref="workspaceImport"
            type="file"
            accept=".json,application/json"
            hidden
            @change="importWorkspace"
          />
          <p v-if="workspaceError" class="gis-ui-error" role="alert">{{ workspaceError }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
