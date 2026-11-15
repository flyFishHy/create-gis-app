import type { LayerLegend } from '@joinmap/gis-core'

export interface UniformLayerStyle {
  fillColor: string
  strokeColor: string
  strokeWidth: number
  pointRadius: number
}
export interface LegendEditValue {
  legend: LayerLegend | null
  style?: UniformLayerStyle
}
