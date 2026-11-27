import type { GISApp } from '@joinmap/gis-core';
import type { ToolbarService } from '../../types.js';

/** Presentation of known basics, rather than a second tool registry. */
export function registerBuiltinToolbar(
  app: GISApp,
  toolbar: ToolbarService,
  visibleIds?: readonly string[]
): void {
  const visible = (id: string) => visibleIds === undefined || visibleIds.includes(id);
  for (const delta of [1, -1]) {
    const id = delta > 0 ? 'zoom-in' : 'zoom-out';
    if (visible(id)) {
      toolbar.register({
        id,
        title: `tool.${id}`,
        icon: id,
        group: 'zoom',
        order: delta > 0 ? 1 : 2,
        disabled: () => !app.map.isReady,
        onClick: () => {
          const view = app.map.getView();
          view.setZoom((view.getZoom() ?? 0) + delta);
        },
      });
    }
  }
  const tools = [
    ['measure-area', 'area'],
    ['measure-angle', 'angle'],
    ['measure-distance', 'distance'],
    ['draw-point', 'pin'],
    ['draw-line', 'edit'],
    ['draw-polygon', 'polygon'],
    ['modify-result', 'edit'],
    ['delete-result', 'clear'],
    ['clear-results', 'layers'],
  ] as const;
  tools.forEach(([id, icon], index) => {
    if (visible(id)) {
      toolbar.register({
        id,
        icon,
        toolId: id,
        title: `tool.${id}`,
        group: index < 6 ? 'draw' : 'edit',
        order: 10 + index,
        disabled: () => !app.interactions.canActivateTool(id),
      });
    }
  });
}
