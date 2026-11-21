export type PanelPosition = 'left' | 'right' | 'top' | 'bottom' | 'floating'

export interface UIThemeConfig {
  readonly mode?: 'light' | 'dark' | 'system'
  readonly tokens?: Readonly<Record<string, string>>
  readonly className?: string
}

export interface UIConfig {
  /** Known built-in tool IDs to show; omitted shows all available built-ins. */
  readonly tools?: readonly string[]
  readonly layout?: string
  readonly theme?: 'light' | 'dark' | 'system' | UIThemeConfig
  readonly locale?: 'zh' | 'en'
  readonly panels?: readonly PanelConfig[]
  readonly timePicker?: UITimePickerConfig
}

export interface UITimePickerConfig {
  readonly granularities?: readonly ('hour' | 'day' | 'week' | 'month' | 'year')[]
  readonly defaultGranularity?: 'hour' | 'day' | 'week' | 'month' | 'year'
  readonly defaultMode?: 'single' | 'range' | 'custom-range'
  readonly defaultTimeZone?: string
  readonly showGranularitySwitch?: boolean
  readonly showModeSwitch?: boolean
  readonly showShortcuts?: boolean
  readonly confirmable?: boolean
  readonly clearable?: boolean
  readonly disabled?: boolean
  readonly minTime?: number
  readonly maxTime?: number
  readonly maxRangeDurationMs?: number
}

/** Framework-independent, serializable panel metadata shared by UI adapters. */
export interface PanelDescriptor {
  readonly id: string
  readonly title?: string
  readonly position?: PanelPosition
  readonly order?: number
  readonly defaultVisible?: boolean
}

/** Application configuration for a panel that has been registered in the UI. */
export interface PanelConfig {
  readonly id: string
  readonly visible?: boolean
  readonly collapsed?: boolean
  readonly position?: PanelPosition
  readonly order?: number
  readonly width?: number | string
  readonly height?: number | string
}

export interface UIAdapter {
  mount(target: Element | string): void | Promise<void>
  unmount(): void | Promise<void>
  dispose(): void | Promise<void>
}
