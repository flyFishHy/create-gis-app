import { PropertiesPanel, type VueUIPlugin } from '@joinmap/ui-vue'

/** Selection presentation belongs to the UI extension, not Core or the adapter. */
export function createPropertiesUI(): VueUIPlugin {
  return { name: 'properties-ui', install(ui) {
    const unregister = ui.panels.register({
      id: 'properties', title: 'panel.properties', component: PropertiesPanel,
      position: 'right', defaultVisible: false, collapsible: false, closable: true,
    })
    const sync = () => {
      if (ui.app.interactions.getSelection()) ui.panels.show('properties')
      else ui.panels.hide('properties')
    }
    sync()
    // Observe selection events only: unrelated state changes must not reopen a closed drawer.
    const stop = ui.app.interactions.onSelect(sync)
    return () => { stop(); unregister() }
  } }
}
