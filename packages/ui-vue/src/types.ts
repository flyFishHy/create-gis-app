import type { Component } from 'vue'
import type { UIConfig, SearchService } from '@joinmap/gis-core'
import type {
  FeatureReference,
  LegendDefinition,
  LegendItem,
  LegendStop,
  PanelConfig,
  PanelDescriptor,
  PanelPosition,
} from '@joinmap/gis-core'

export type BuiltinLayoutName = 'docked-dashboard' | 'overlay-dashboard'

export interface VuePanelDefinition extends PanelDescriptor {
  readonly component: Component
  readonly icon?: string
  readonly defaultCollapsed?: boolean
  readonly width?: number | string
  readonly minWidth?: number | string
  readonly maxWidth?: number | string
  readonly height?: number | string
  readonly minHeight?: number | string
  readonly maxHeight?: number | string
  readonly collapsible?: boolean
  readonly closable?: boolean
  /** Render content directly, without a panel header, border or actions. */
  readonly unframed?: boolean
  readonly props?: Readonly<Record<string, unknown>>
}

export interface PanelState {
  readonly id: string
  readonly visible: boolean
  readonly collapsed: boolean
  readonly position: PanelPosition
  readonly order: number
  readonly width?: number | string
  readonly height?: number | string
}

export interface PanelService {
  register(definition: VuePanelDefinition): () => void
  get(id: string): VuePanelDefinition | undefined
  list(position?: PanelPosition): VuePanelDefinition[]
  show(id: string): void
  hide(id: string): void
  toggle(id: string): void
  collapse(id: string): void
  expand(id: string): void
  setOrder(ids: string[], position?: PanelPosition): void
  getState(id: string): PanelState | undefined
}

export type {
  SearchResult,
  SearchQuery,
  SearchProvider,
  SearchService,
  UIConfig,
} from '@joinmap/gis-core'

export interface ToolbarItemDefinition {
  readonly display?: () => string
  readonly id: string
  readonly title: string
  readonly icon?: string
  readonly group?: string
  readonly order?: number
  readonly disabled?: boolean | (() => boolean)
  readonly active?: boolean
  readonly shortcut?: string
  readonly onClick?: () => void | Promise<void>
  readonly toolId?: string
}

export interface ToolbarService {
  register(item: ToolbarItemDefinition): () => void
  list(): ToolbarItemDefinition[]
}

export interface ThemeTokens {
  colorBackground: string
  colorSurface: string
  colorSurfaceElevated: string
  colorText: string
  colorTextMuted: string
  colorBorder: string
  colorPrimary: string
  colorHover: string
  colorSuccess: string
  colorDanger: string
  panelRadius: string
  panelShadow: string
  panelStyle?: 'frosted' | 'liquid' | 'solid'
  panelOpacity?: string
  panelBlur?: string
  panelSpecular?: string
  panelWidth: string
  leftPanelWidth: string
  rightPanelWidth: string
  overlayPanelWidth: string
  toolbarHeight: string
  spacingUnit: string
  fontFamily: string
  fontSize: string
}

export interface ThemeOptions {
  mode?: 'light' | 'dark' | 'system'
  tokens?: Partial<ThemeTokens>
  className?: string
}

export interface ThemeService {
  get(): Readonly<ThemeOptions>
  set(options: ThemeOptions): void
  subscribe(listener: (theme: Readonly<ThemeOptions>) => void): () => void
}

export type Locale = 'zh' | 'en'

export interface GisSwitchOption {
  readonly value: string
  readonly label?: string
  readonly icon?: string
  readonly ariaLabel?: string
}

export interface LocaleService {
  get(): Locale
  set(locale: Locale): void
  subscribe(listener: (locale: Locale) => void): () => void
  t(key: string): string
}

export interface FeatureRendererDefinition {
  readonly id: string
  readonly match: (feature: FeatureReference) => boolean
  readonly component: Component
  readonly priority?: number
}

export interface FeatureRendererService {
  register(definition: FeatureRendererDefinition): () => void
  resolve(feature: FeatureReference): FeatureRendererDefinition | undefined
}

export interface VueUIPlugin {
  readonly name: string
  install(ui: GISUIContext): void | (() => void)
}

export interface KpiItem {
  readonly id: string
  readonly label: string
  readonly value: string | number
  readonly unit?: string
  readonly hint?: string
}

export interface GISUIContext {
  readonly app: import('@joinmap/gis-core').GISApp
  readonly panels: PanelService
  readonly search: SearchService
  readonly toolbar: ToolbarService
  readonly theme: ThemeService
  readonly locale: LocaleService
  readonly featureRenderers: FeatureRendererService
  readonly toolbarComponent?: Component
  readonly statusComponent?: Component
}

export interface VueUIOptions {
  workspaceStorageKey?: string
  config?: UIConfig
  layouts?: Readonly<Record<string, Component>>
  panelDefinitions?: readonly VuePanelDefinition[]
  toolbarItems?: readonly ToolbarItemDefinition[]
  extensions?: readonly VueUIPlugin[]
  appProps?: Record<string, unknown>
  toolbarComponent?: Component
  statusComponent?: Component
}

export type {
  LegendDefinition,
  LegendItem,
  LegendStop,
  PanelConfig,
  PanelDescriptor,
  PanelPosition,
}
