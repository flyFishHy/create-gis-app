import type { LayerLegend, LayerStyle, LegendDefinition } from '@joinmap/gis-core';
import { asArray as parseColor } from 'ol/color.js';

export const defaultVectorStyle = {
  fillColor: '#ffffff66',
  strokeColor: '#3399cc',
  strokeWidth: 1.25,
  pointRadius: 5,
};

export function validateLegendColors(legend: LayerLegend | null | undefined): void {
  for (const item of legend?.items ?? []) {
    if (item.color) {
      parseColor(item.color);
    }
  }
  for (const range of legend?.ranges ?? []) {
    parseColor(range.color);
  }
  if (legend?.noData?.color) {
    parseColor(legend.noData.color);
  }
}

export function resolveSingleSymbolLegend(
  value: LegendDefinition,
  style: LayerStyle
): LegendDefinition {
  if (
    value.field ||
    !value.useLayerStyle ||
    value.type !== 'category' ||
    value.items?.length !== 1
  ) {
    return value;
  }
  return {
    ...value,
    items: value.items.map((item) => ({
      ...item,
      color: item.symbol === 'line' ? style.strokeColor : style.fillColor,
    })),
  };
}
