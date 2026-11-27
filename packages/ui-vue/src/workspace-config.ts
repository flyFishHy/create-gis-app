import { parseGISAppConfig } from '@joinmap/gis-core';
import type {
  AppState,
  GISApp,
  GISAppConfig,
  LayerConfig,
  LayerInstance,
  UIConfig,
} from '@joinmap/gis-core';

const initialLayers = new WeakMap<GISApp, WeakSet<LayerInstance>>();

export function rememberWorkspaceLayers(app: GISApp): void {
  initialLayers.set(app, new WeakSet(app.layers.list()));
}

export function workspacePreferences(
  extensions: ReturnType<AppState['snapshot']>['extensions']
): Pick<UIConfig, 'theme' | 'locale' | 'layout'> | undefined {
  const ui = extensions['vue-ui'];
  if (ui && typeof ui === 'object' && !Array.isArray(ui)) {
    const { theme, locale, layout } = ui as Pick<UIConfig, 'theme' | 'locale' | 'layout'>;
    return { theme, locale, layout };
  }
}

/** Export the current UI preferences and the live settings of configured layers. */
export function captureWorkspaceConfig(app: GISApp): Readonly<GISAppConfig> {
  const snapshot = app.context.state.snapshot();
  const base = app.config ?? {};
  const savedUI = workspacePreferences(snapshot.extensions);
  const layers = new Map(snapshot.layers.map((layer) => [layer.id, layer]));
  const initial = initialLayers.get(app);
  function capture(config: LayerConfig, parentId: string | null): LayerConfig[] {
    const layer = layers.get(config.id);
    if (layer?.status !== 'ready' || layer.type !== config.type || layer.parentId !== parentId) {
      return [];
    }
    if (initial) {
      const instance = app.layers.get(config.id);
      if (!instance || !initial.has(instance)) {
        return [];
      }
    }
    const {
      legend: _legend,
      style: _style,
      children: _children,
      zIndex: _order,
      ...original
    } = config;
    const children = config.children?.flatMap((child) => capture(child, config.id));
    if (layer.type === 'GROUP' && !children?.length) {
      return [];
    }
    const { opacity } = layer.metadata;
    const { layerId: _layerId, ...legend } = layer.legend ?? {};
    return [
      {
        ...original,
        title: layer.title ?? config.title,
        visible: layer.ownVisible,
        ...(children ? { children } : { zIndex: layer.zIndex }),
        ...(layer.legend ? { legend: legend as LayerConfig['legend'] } : {}),
        ...(layer.style ? { style: layer.style } : {}),
        ...(typeof opacity === 'number' ? { options: { ...config.options, opacity } } : {}),
      },
    ];
  }
  return parseGISAppConfig(
    JSON.parse(
      JSON.stringify({
        ...base,
        ...(base.layers ? { layers: base.layers.flatMap((layer) => capture(layer, null)) } : {}),
        ...(savedUI ? { ui: { ...base.ui, ...savedUI } } : {}),
      })
    )
  );
}

/** Before init, restore a validated browser-local configuration when available. */
export function loadWorkspaceConfig(
  storageKey: string,
  fallback: Readonly<GISAppConfig>
): Readonly<GISAppConfig> {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      return parseGISAppConfig(JSON.parse(saved));
    }
  } catch {
    /* Use the application defaults if storage is unavailable or invalid. */
  }
  return fallback;
}
