import { normalizeUIConfig } from '@joinmap/gis-core';
import type { PanelConfig, UIConfig, UIThemeConfig } from '@joinmap/gis-core';

function theme(value: UIConfig['theme']): UIThemeConfig {
  return typeof value === 'string' ? { mode: value } : (value ?? {});
}
export function resolveUIConfig(defaults: UIConfig = {}, app: UIConfig = {}): Readonly<UIConfig> {
  normalizeUIConfig(defaults);
  normalizeUIConfig(app);
  const layout = app.layout ?? defaults.layout ?? 'docked-dashboard';
  const panels = new Map<string, PanelConfig>();
  for (const config of [defaults.panels ?? [], app.panels ?? []]) {
    for (const panel of config) {
      panels.set(panel.id, { ...panels.get(panel.id), ...panel });
    }
  }
  const baseTheme = theme(defaults.theme),
    overrideTheme = theme(app.theme);
  return normalizeUIConfig({
    layout,
    locale: app.locale ?? defaults.locale ?? 'zh',
    theme: {
      mode: 'light',
      ...baseTheme,
      ...overrideTheme,
      tokens: { ...baseTheme.tokens, ...overrideTheme.tokens },
    },
    panels: [...panels.values()],
    ...((app.timePicker ?? defaults.timePicker)
      ? { timePicker: { ...defaults.timePicker, ...app.timePicker } }
      : {}),
    ...((app.tools ?? defaults.tools) ? { tools: app.tools ?? defaults.tools } : {}),
  });
}
