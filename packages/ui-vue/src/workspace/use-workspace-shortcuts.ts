import { GISRuntimeError, type GISApp } from '@joinmap/gis-core';

export function useWorkspaceShortcuts(app: GISApp) {
  async function handleKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.matches('input,textarea,select') || target.isContentEditable)
    ) {
      return;
    }
    try {
      const interactions = app.interactions;
      if (event.key === 'Escape') {
        const activeTool = interactions.getActiveTool();
        await interactions.deactivateTool();
        if (
          activeTool &&
          !interactions.getActiveTool() &&
          target instanceof HTMLButtonElement &&
          target.closest('.gis-ui-toolbar') &&
          target.ownerDocument.activeElement === target
        ) {
          target.blur();
        }
      }
      if (event.key === 'Backspace' && interactions.getActiveTool()) {
        event.preventDefault();
        interactions.undoActiveTool();
      }
    } catch (cause) {
      reportToolError(cause);
    }
  }
  function reportToolError(cause: unknown) {
    app.events.emit('app:error', {
      error: new GISRuntimeError({
        code: 'APP_INVALID_STATE',
        message: 'Tool shortcut failed.',
        cause,
      }),
    });
  }
  return handleKeydown;
}
