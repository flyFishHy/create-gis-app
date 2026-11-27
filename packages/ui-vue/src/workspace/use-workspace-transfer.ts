import { shallowRef, useTemplateRef } from 'vue';
import { parseGISAppConfig, type GISApp } from '@joinmap/gis-core';
import type { LocaleService } from '../types.js';
import { captureWorkspaceConfig } from '../workspace-config.js';

export function useWorkspaceTransfer(
  app: GISApp,
  locale: LocaleService,
  getStorageKey: () => string | undefined
) {
  const workspaceError = shallowRef('');
  const importInput = useTemplateRef<HTMLInputElement>('workspaceImport');

  function exportWorkspace() {
    workspaceError.value = '';
    try {
      const config = captureWorkspaceConfig(app);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'gis-workspace.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      workspaceError.value = locale.t('workspace.exportFailed');
    }
  }

  async function importWorkspace() {
    const input = importInput.value;
    const file = input?.files?.[0];
    const key = getStorageKey();
    if (!file || !input || !key) {
      return;
    }
    input.value = '';
    workspaceError.value = '';
    try {
      const config = parseGISAppConfig(JSON.parse(await file.text()));
      localStorage.setItem(key, JSON.stringify(config));
      window.location.reload();
    } catch {
      workspaceError.value = locale.t('workspace.importFailed');
    }
  }

  return { workspaceError, importInput, exportWorkspace, importWorkspace };
}
