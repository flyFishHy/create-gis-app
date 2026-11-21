import type { UITimePickerConfig } from '@joinmap/gis-core'

export const timeGranularities = ['hour', 'day', 'week', 'month', 'year'] as const
export const timeSelectionModes = ['single', 'range', 'custom-range'] as const

export type TimeGranularity = typeof timeGranularities[number]
export type TimeSelectionMode = typeof timeSelectionModes[number]

export interface TimeRange {
  start: number
  endExclusive: number
}

export interface TimeSelection {
  mode: TimeSelectionMode
  granularity: TimeGranularity | 'custom'
  timeZone: string
  range: TimeRange
}

export interface TimeFilterPickerProps extends UITimePickerConfig {
  modelValue?: TimeSelection | null
  locale?: 'zh-CN' | 'en'
}

export interface TimeFilterPickerEmits {
  'update:modelValue': [value: TimeSelection | null]
  change: [value: TimeSelection | null]
  apply: [value: TimeSelection]
  clear: []
  cancel: []
}

export interface TimePickerDraft {
  mode: TimeSelectionMode
  granularity: TimeGranularity
  timeZone: string
  start?: number
  end?: number
}
