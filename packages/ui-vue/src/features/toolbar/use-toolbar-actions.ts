import { computed, ref } from 'vue';
import type { ToolbarItemDefinition } from '../../types.js';
import { useAppState } from '../../use-app-state.js';
import { useGISApp } from '../../use-gis-app.js';
import { useGISUI } from '../../use-gis-ui.js';

export function useToolbarActions() {
  const app = useGISApp();
  const ui = useGISUI();
  const snapshot = useAppState();
  const activeTool = computed(() => snapshot.value.interactions.activeToolId);
  const error = ref<string>();
  const groups = computed(itemGroups);

  function itemGroups() {
    const groupedItems = new Map<string, ToolbarItemDefinition[]>();
    for (const item of ui.toolbar.list()) {
      if (item.toolId && !app.interactions.hasTool(item.toolId)) {
        continue;
      }
      const key = item.group ?? '';
      groupedItems.set(key, [...(groupedItems.get(key) ?? []), item]);
    }
    return [...groupedItems.entries()];
  }

  function isDisabled(item: ToolbarItemDefinition) {
    // Predicates may read public Runtime services without accessing Vue refs themselves.
    void snapshot.value.revision;
    return typeof item.disabled === 'function' ? item.disabled() : (item.disabled ?? false);
  }

  async function run(item: ToolbarItemDefinition) {
    error.value = undefined;
    try {
      if (item.toolId) {
        if (activeTool.value === item.toolId) {
          await app.interactions.deactivateTool();
        } else {
          await app.interactions.activateTool(item.toolId);
        }
        return;
      }
      await item.onClick?.();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }

  return { activeTool, error, groups, isDisabled, run };
}
