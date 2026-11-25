import type { LayerLegend, LayerStyle } from '@joinmap/gis-core';

export interface UniformLayerStyle {
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  pointRadius: number;
  fillOpacity?: LayerStyle['fillOpacity'];
  lineDash?: LayerStyle['lineDash'];
  lineCap?: LayerStyle['lineCap'];
}
export interface LegendEditValue {
  legend: LayerLegend | null;
  style?: UniformLayerStyle;
}
