import type { GISPlugin } from '@joinmap/gis-core';
import './styles.scss';
import { installBuiltinFeatures } from './adapter/builtin-features.js';
import { createUIContext } from './adapter/create-ui-context.js';
import { VueUIAdapter, trackVueUIAdapter } from './adapter/vue-ui-adapter.js';
import type { VueUIOptions } from './types.js';
import { registerUIState } from './workspace/ui-state-contributor.js';
import { registerWorkspacePersistence } from './workspace/workspace-persistence.js';

export function createVueUI(options: VueUIOptions = {}): GISPlugin<VueUIOptions> {
  return {
    name: 'gis-vue-ui',
    install(runtime, pluginOptions, resources) {
      const resolved = pluginOptions ?? options;
      const { context, config, activeLayout, customLayout, changeLayout } = createUIContext(
        runtime,
        resolved,
        resources
      );
      const adapter = new VueUIAdapter({
        runtime,
        ui: context,
        activeLayout,
        customLayout,
        changeLayout,
        appProps: resolved.appProps ?? {},
        workspaceStorageKey: resolved.workspaceStorageKey,
      });
      runtime.registerUIAdapter(adapter, resources);
      trackVueUIAdapter(runtime, adapter, resources);

      const getTimeSelection = installBuiltinFeatures(
        context,
        config,
        resolved,
        activeLayout,
        customLayout,
        resources
      );
      const names = new Set<string>();
      for (const extension of resolved.extensions ?? []) {
        if (!extension.name.trim() || names.has(extension.name)) {
          throw new Error(`Invalid or duplicate UI extension "${extension.name}".`);
        }
        names.add(extension.name);
        const cleanup = extension.install(context);
        if (cleanup) {
          resources.add(cleanup);
        }
      }
      context.panels.warnForUnknownConfiguredPanels();
      registerUIState(runtime, context, activeLayout, getTimeSelection, resources);
      registerWorkspacePersistence(runtime, resolved.workspaceStorageKey, resources);
    },
  };
}
