import { normalizeUIConfig } from '@joinmap/gis-core'
import type { PanelConfig, UIConfig, UIThemeConfig } from '@joinmap/gis-core'

export const builtinPanels: readonly PanelConfig[] = [
  { id: 'search', visible: true, position: 'top', order: 0 },
  { id: 'time', visible: true, position: 'top', order: 1 },
  { id: 'layer-manager', visible: true, position: 'left', order: 1 },
  { id: 'legend', visible: true, position: 'left', order: 2 },
  { id: 'toolbar', visible: true },
  { id: 'popup', visible: false, position: 'floating' },
  { id: 'properties', visible: false, position: 'right', order: 2 },
  { id: 'status', visible: true, position: 'bottom' },
]
function theme(value: UIConfig['theme']): UIThemeConfig {
  return typeof value === 'string' ? { mode: value } : value ?? {}
}
export function resolveUIConfig(defaults: UIConfig = {}, app: UIConfig = {}): Readonly<UIConfig> {
  normalizeUIConfig(defaults); normalizeUIConfig(app)
  const layout = app.layout ?? defaults.layout ?? 'docked-dashboard'
  const preset = builtinPanels.map(panel => panel.id === 'properties' ? { ...panel, visible: layout === 'docked-dashboard' }
    : layout === 'overlay-dashboard' && (panel.id === 'layer-manager' || panel.id === 'legend') ? { ...panel, position: 'right' as const } : panel)
  const panels = new Map<string, PanelConfig>()
  for (const config of [preset, defaults.panels ?? [], app.panels ?? []]) {
    for (const panel of config) panels.set(panel.id, { ...panels.get(panel.id), ...panel })
  }
  const baseTheme = theme(defaults.theme), overrideTheme = theme(app.theme)
  return normalizeUIConfig({
    layout,
    locale: app.locale ?? defaults.locale ?? 'zh',
    theme: { mode: 'light', ...baseTheme, ...overrideTheme, tokens: { ...baseTheme.tokens, ...overrideTheme.tokens } },
    panels: [...panels.values()],
    ...((app.tools ?? defaults.tools) ? { tools: app.tools ?? defaults.tools } : {}),
  })
}
