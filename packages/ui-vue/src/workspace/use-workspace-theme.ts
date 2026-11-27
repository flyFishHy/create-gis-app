import { computed, onBeforeUnmount, shallowRef, type CSSProperties, type Ref } from 'vue';
import type { ThemeOptions, ThemeService, ThemeTokens } from '../types.js';

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

export function useWorkspaceTheme(
  service: ThemeService,
  layout: Readonly<Ref<string | undefined>>
) {
  const theme = shallowRef<Readonly<ThemeOptions>>(service.get());
  const unsubscribeTheme = service.subscribe((next) => {
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
  return { themeClasses, mapStyle, panelStyle, themeStyle };
}
