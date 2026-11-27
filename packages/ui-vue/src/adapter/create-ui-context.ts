import { shallowRef } from 'vue';
import type { GISApp, ResourceScope } from '@joinmap/gis-core';
import { resolveUIConfig } from '../config.js';
import { PanelRegistry } from '../panels/panel-registry.js';
import { FeatureRendererServiceImpl } from '../services/feature-renderer-service.js';
import { LocaleServiceImpl } from '../services/locale-service.js';
import { ThemeServiceImpl } from '../services/theme-service.js';
import { ToolbarServiceImpl } from '../services/toolbar-service.js';
import type { BuiltinLayoutName, GISUIContext, ThemeOptions, VueUIOptions } from '../types.js';

export function createUIContext(runtime: GISApp, options: VueUIOptions, resources: ResourceScope) {
  const maxVisibleTools = options.toolbarMaxVisibleTools;
  if (
    maxVisibleTools !== undefined &&
    (!Number.isInteger(maxVisibleTools) || maxVisibleTools < 0)
  ) {
    throw new Error('toolbarMaxVisibleTools must be a non-negative integer.');
  }
  const config = resolveUIConfig(options.config, runtime.config?.ui);
  const layout = config.layout!;
  const activeLayout = shallowRef(layout);
  const customLayout = options.layouts?.[layout];
  if (!customLayout && layout !== 'docked-dashboard' && layout !== 'overlay-dashboard') {
    throw new Error(`Unknown UI layout "${layout}". Register its component in layouts.`);
  }
  let changeLayout: ((layout: BuiltinLayoutName) => void) | undefined;
  if (
    !customLayout &&
    !options.layouts?.['docked-dashboard'] &&
    !options.layouts?.['overlay-dashboard']
  ) {
    changeLayout = (value) => {
      activeLayout.value = value;
    };
  }
  const panelRegistry = new PanelRegistry(config.panels?.filter((panel) => panel.id !== 'popup'));
  const toolbar = new ToolbarServiceImpl();
  const theme = new ThemeServiceImpl(config.theme as ThemeOptions);
  const locale = new LocaleServiceImpl(config.locale);
  const featureRenderers = new FeatureRendererServiceImpl();

  resources.add(() => panelRegistry.clear());
  resources.add(() => toolbar.clear());
  resources.add(() => theme.clear());
  resources.add(() => locale.clear());
  resources.add(() => featureRenderers.clear());

  const context = Object.freeze({
    app: runtime,
    panels: panelRegistry,
    search: runtime.search,
    toolbar,
    theme,
    locale,
    featureRenderers,
    toolbarComponent: options.toolbarComponent,
    statusComponent: options.statusComponent,
  } satisfies GISUIContext);
  return { context, config, activeLayout, customLayout, changeLayout };
}
