import { normalizeUIConfig } from '@joinmap/gis-core'
import type { PanelConfig, UIConfig, UIThemeConfig } from '@joinmap/gis-core'

export const builtinPanels: readonly PanelConfig[] = [
  { id: 'search', visible: true, position: 'top', order: 0 },
  { id: 'time', visible: true, position: 'top', order: 1 },
  { id: 'layer-manager', visible: true, position: 'left', order: 1 },
  { id: 'legend', visible: true, position: 'left', order: 2 },
  { id: 'toolbar', visible: true },
  { id: 'popup', visible: false, position: 'floating' },
]
function theme(value: UIConfig['theme']): UIThemeConfig {
  return typeof value === 'string' ? { mode: value } : value ?? {}
}
export function resolveUIConfig(defaults: UIConfig = {}, app: UIConfig = {}): Readonly<UIConfig> {
  normalizeUIConfig(defaults); normalizeUIConfig(app)
  const panels = new Map<string, PanelConfig>()
  for (const config of [builtinPanels, defaults.panels ?? [], app.panels ?? []]) {
    for (const panel of config) panels.set(panel.id, { ...panels.get(panel.id), ...panel })
  }
  const baseTheme = theme(defaults.theme), overrideTheme = theme(app.theme)
  return normalizeUIConfig({
    layout: app.layout ?? defaults.layout ?? 'docked-dashboard',
    locale: app.locale ?? defaults.locale ?? 'zh',
    theme: { mode: 'light', ...baseTheme, ...overrideTheme, tokens: { ...baseTheme.tokens, ...overrideTheme.tokens } },
    panels: [...panels.values()],
  })
}
