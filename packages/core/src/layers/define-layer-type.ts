import type { AppContext, LayerConfig, LayerTypeDefinition, MapLayerHandle } from '../types.js';

export function defineLayerType<Config extends LayerConfig>(definition: {
  normalize(config: LayerConfig): Config;
  create(context: AppContext, config: Config): MapLayerHandle | Promise<MapLayerHandle>;
}): LayerTypeDefinition {
  return {
    normalize: (config) => definition.normalize(config),
    // LayerCreation validates the whole tree through normalize before invoking any factory.
    create: (context, config) => definition.create(context, config as Config),
  };
}
