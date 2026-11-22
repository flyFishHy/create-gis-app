export type SelectValue = string | number | boolean
export interface MultiSelectOption {
  value: SelectValue
  label: string
  disabled?: boolean
  hint?: string
}
export const selectValueKey = (value: SelectValue): string =>
  `${typeof value}:${JSON.stringify(value)}`
