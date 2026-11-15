import { defineComponent, h, ref, onBeforeUnmount } from 'vue'
import { useOLTools } from '@joinmap/adapter-ol'
import type { VueUIPlugin } from '@joinmap/ui-vue'

/** Optional advanced result list; the normal toolbar/status/properties need no extension. */
export function createOLResultsUI(): VueUIPlugin {
  return { name: 'ol-results-ui', install(ui) {
    const controller = useOLTools(ui.app)
    const cleanups: Array<() => void> = []
    const Results = defineComponent({ setup() {
      const revision = ref(0)
      const stop = controller.subscribe(() => { revision.value++ })
      onBeforeUnmount(stop)
      return () => {
        void revision.value
        return h('div', { class: 'gis-tool-results' }, controller.list().map(result => h('div', { key: result.id }, [
          h('button', { type: 'button', 'aria-pressed': controller.selected() === result.id, onClick: () => controller.select(result.id) },
            `${ui.locale.t(`tool.${result.toolId}`)}: ${result.value === undefined ? result.id : result.value.toFixed(2) + ' ' + result.unit}`),
          h('button', { type: 'button', 'aria-label': `${ui.locale.t('action.delete')} ${result.id}`, onClick: () => controller.remove(result.id) }, '×'),
        ])))
      }
    } })
    cleanups.push(ui.panels.register({ id: 'tool-results', title: 'tool.results', component: Results, position: 'bottom', defaultVisible: true, unframed: true }))
    return () => { cleanups.reverse().forEach(stop => stop()) }
  } }
}
