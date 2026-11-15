import { defineComponent, h, ref, onBeforeUnmount } from 'vue'
import { useOLMap, useOLTools, olTools } from '@joinmap/adapter-ol'
import type { VueUIPlugin } from '@joinmap/ui-vue'

/** Reusable integration using only public Runtime/OL/UI entry points. */
export function createOLToolsUI(): VueUIPlugin {
  return { name: 'ol-tools-ui', install(ui) {
    const app = ui.app
    const controller = useOLTools(app)
    const cleanups: Array<() => void> = []
    for (const delta of [1, -1]) cleanups.push(ui.toolbar.register({ id: delta > 0 ? 'zoom-in' : 'zoom-out',
      title: delta > 0 ? 'tool.zoom-in' : 'tool.zoom-out', icon: delta > 0 ? 'zoom-in' : 'zoom-out', group: 'zoom', order: delta > 0 ? 1 : 2,
      onClick: () => { const view = app.map.getView(); view.setZoom((view.getZoom() ?? 0) + delta) } }))
    olTools.forEach((tool, index) => cleanups.push(ui.toolbar.register({ ...tool, title: `tool.${tool.id}`, toolId: tool.id, order: 10 + index, group: 'draw' })))
    cleanups.push(ui.toolbar.register({ id: 'delete-result', title: 'tool.delete-result', icon: 'clear', group: 'edit', order: 30,
      disabled: () => app.context.state.snapshot().interactions.selection?.source !== 'ol-tools',
      onClick: () => { const id = controller.selected(); if (id) controller.remove(id) } }))
    cleanups.push(ui.toolbar.register({ id: 'clear-results', title: 'tool.clear-results', icon: 'layers', group: 'edit', order: 31, onClick: () => controller.clear() }))
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
    let ownsFocus = false
    const focus = (event: Event) => {
      const target = event.target
      const viewport = app.map.isReady ? useOLMap(app).getTargetElement() : undefined
      ownsFocus = !!viewport && target instanceof Node && !!viewport.closest('.gis-ui-root')?.contains(target)
    }
    const keydown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && (target.matches('input,textarea,select') || target.isContentEditable)) return
      if (!ownsFocus) return
      if (event.key === 'Escape') void controller.cancel().catch(error => console.error(error))
      if (event.key === 'Backspace' && app.interactions.getActiveTool()) { event.preventDefault(); controller.undo() }
    }
    document.addEventListener('keydown', keydown)
    document.addEventListener('pointerdown', focus)
    document.addEventListener('focusin', focus)
    return () => { document.removeEventListener('keydown', keydown); document.removeEventListener('pointerdown', focus); document.removeEventListener('focusin', focus); cleanups.reverse().forEach(stop => stop()) }
  } }
}
