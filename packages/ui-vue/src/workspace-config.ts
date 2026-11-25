import { parseGISAppConfig } from '@joinmap/gis-core';
import type { GISApp, GISAppConfig, LayerConfig, UIConfig } from '@joinmap/gis-core';

/** Export the current UI preferences and the live settings of configured layers. */
export function captureWorkspaceConfig(app: GISApp): Readonly<GISAppConfig> {
  const snapshot = app.context.state.snapshot();
  const base = app.config ?? {};
  const savedUI = snapshot.extensions['vue-ui'] as
    Pick<UIConfig, 'theme' | 'locale' | 'layout'> | undefined;
  const layers = new Map(snapshot.layers.map((layer) => [layer.id, layer]));
  function capture(config: LayerConfig): LayerConfig[] {
    const layer = layers.get(config.id);
    if (!layer || layer.type !== config.type) {
      return [];
    }
    const {
      legend: _legend,
      style: _style,
      children: _children,
      zIndex: _order,
      ...original
    } = config;
    const children = config.children?.flatMap(capture);
    if (layer.type === 'GROUP' && !children?.length) {
      return [];
    }
    const { opacity, zIndex } = layer.metadata;
    const { layerId: _layerId, ...legend } = layer.legend ?? {};
    return [
      {
        ...original,
        title: layer.title ?? config.title,
        visible: layer.visible,
        ...(children
          ? { children }
          : { zIndex: typeof zIndex === 'number' ? zIndex : config.zIndex }),
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
        ...(base.layers ? { layers: base.layers.flatMap(capture) } : {}),
        ...(savedUI
          ? {
              ui: {
                ...base.ui,
                theme: savedUI.theme,
                locale: savedUI.locale,
                layout: savedUI.layout,
              },
            }
          : {}),
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
