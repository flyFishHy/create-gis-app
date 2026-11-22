import type { PanelService } from '../types.js'

export function cssSize(value: number | string | undefined): string | undefined {
  return typeof value === 'number' ? `${value}px` : value
}

/** A shared region reserves enough width for every visible panel in it. */
export function regionWidth(
  panels: PanelService,
  position: 'left' | 'right',
  exclude: readonly string[] = []
): string | undefined {
  const widths = panels
    .list(position)
    .filter((panel) => !exclude.includes(panel.id))
    .flatMap((panel) => {
      const state = panels.getState(panel.id)
      const width = state?.visible ? cssSize(state.width) : undefined
      return width ? [width] : []
    })
  return widths.length > 1 ? `max(${widths.join(', ')})` : widths[0]
}
