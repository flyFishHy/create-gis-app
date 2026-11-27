import type { Component, ShallowRef } from 'vue';
import type { ResourceScope, UIConfig } from '@joinmap/gis-core';
import LayerManagerPanel from '../features/layer-manager/LayerManagerPanel.vue';
import LegendPanel from '../features/legend/LegendPanel.vue';
import MapStatusPanel from '../panels/MapStatusPanel.vue';
import PropertiesPanel from '../panels/PropertiesPanel.vue';
import SearchPanel from '../panels/SearchPanel.vue';
import Toolbar from '../features/toolbar/GisToolbar.vue';
import { registerBuiltinToolbar } from '../features/toolbar/builtin-toolbar.js';
import { installTimePicker } from '../features/time-picker/install.js';
import { installPropertiesSelection } from '../features/properties/selection.js';
import { withLayoutRole } from '../layouts/layout-regions.js';
import type { GISUIContext, VuePanelDefinition, VueUIOptions } from '../types.js';

export function installBuiltinFeatures(
  context: GISUIContext,
  config: Readonly<UIConfig>,
  options: VueUIOptions,
  layout: Readonly<ShallowRef<string>>,
  customLayout: Component | undefined,
  resources: ResourceScope
) {
  const runtime = context.app;
  registerBuiltinToolbar(runtime, context.toolbar, config.tools);
  for (const item of options.toolbarItems ?? []) {
    context.toolbar.register(item);
  }
  context.panels.register({
    id: 'search',
    title: 'panel.search',
    component: SearchPanel,
    position: 'top',
    order: 0,
    defaultVisible: true,
    collapsible: false,
    closable: false,
    unframed: true,
    props: { dropdown: true },
  });
  const getTimeSelection = installTimePicker(context.panels, config.timePicker);
  context.panels.register({
    id: 'layer-manager',
    title: 'panel.layers',
    icon: 'layers',
    header: { badgeLabel: 'layer.count', refreshLabel: 'layer.refresh' },
    component: LayerManagerPanel,
    position: 'left',
    order: 1,
    defaultVisible: true,
    collapsible: false,
    closable: false,
  });
  context.panels.register({
    id: 'legend',
    title: 'panel.legend',
    icon: 'legend',
    header: { badgeLabel: 'legend.count', refreshLabel: 'legend.refresh' },
    component: LegendPanel,
    position: 'left',
    order: 2,
    defaultVisible: true,
    collapsible: false,
    closable: false,
  });
  context.panels.register(
    withLayoutRole(
      {
        id: 'toolbar',
        component: options.toolbarComponent ?? Toolbar,
        allowedPositions: ['top'],
        defaultVisible: true,
        unframed: true,
        props: {
          ...(options.toolbarComponent ? {} : { maxVisibleTools: options.toolbarMaxVisibleTools }),
          get tooltipPlacement() {
            return !customLayout && layout.value === 'overlay-dashboard' ? 'left' : 'bottom';
          },
        },
      },
      'toolbar'
    )
  );
  const propertiesDefaults = {
    position: 'right',
    order: 2,
    defaultVisible: layout.value === 'docked-dashboard',
  } satisfies Partial<VuePanelDefinition>;
  const propertiesIcon = 'sliders-horizontal';
  if (!options.panelDefinitions?.some((panel) => panel.id === 'properties')) {
    context.panels.register(
      withLayoutRole(
        {
          id: 'properties',
          title: 'panel.properties',
          component: PropertiesPanel,
          icon: propertiesIcon,
          ...propertiesDefaults,
          collapsible: false,
          closable: true,
        },
        'drawer'
      )
    );
  }
  context.panels.register(
    withLayoutRole(
      {
        id: 'status',
        component: options.statusComponent ?? MapStatusPanel,
        allowedPositions: ['bottom'],
        defaultVisible: true,
        unframed: true,
      },
      'status'
    )
  );

  for (const panel of options.panelDefinitions ?? []) {
    context.panels.register(
      panel.id === 'properties'
        ? withLayoutRole({ icon: propertiesIcon, ...panel, ...propertiesDefaults }, 'drawer')
        : panel
    );
  }
  resources.add(installPropertiesSelection(context, config, layout));
  return getTimeSelection;
}
