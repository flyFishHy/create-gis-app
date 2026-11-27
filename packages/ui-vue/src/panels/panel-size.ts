import type { PanelState } from '../types.js';

export function cssSize(value: number | string | undefined): string | undefined {
  return typeof value === 'number' ? `${value}px` : value;
}

/** A shared region reserves enough width for every visible panel in it. */
export function regionWidth(
  panels: readonly PanelState[],
  includeHidden = false
): string | undefined {
  const widths = panels.flatMap((state) => {
    const width = state.visible || includeHidden ? cssSize(state.width) : undefined;
    return width ? [width] : [];
  });
  return widths.length > 1 ? `max(${widths.join(', ')})` : widths[0];
}
