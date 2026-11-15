<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, useId, TransitionGroup } from 'vue'
import type { LayerInstance } from '@joinmap/gis-core'
import { useGISApp } from '../use-gis-app.js'
import { useGISUI } from '../use-gis-ui.js'
import SvgIcon from '../components/SvgIcon.vue'
import Tooltip from '../components/Tooltip.vue'
import { layerTree, moveLayer, reorderRootLayers } from './layer-tree.js'
import LayerChildren from './LayerChildren.vue'
import { useAppState } from '../use-app-state.js'

const app = useGISApp()
const ui = useGISUI()
const snapshot = useAppState()
const dragging = shallowRef<LayerInstance>()
const dropTarget = shallowRef<string>()
const dropAfter = shallowRef(false)
const revision = shallowRef(0)
const expanded = shallowRef(new Set<string>())
const drafts = shallowRef<Record<string, number>>({})
const error = shallowRef<string>()
const detailsId = useId()
const queued = new Map<string, number>()
const running = new Set<string>()
let stopped = false
let pointerDrag: { layer: LayerInstance; id: number; x: number; y: number } | undefined
const stop = app.layers.subscribe(event => {
  revision.value++
  if (event.type === 'remove' && event.id) {
    queued.delete(event.id)
    const next = new Set(expanded.value); next.delete(event.id); expanded.value = next
  }
})
onBeforeUnmount(() => { stopped = true; queued.clear(); stop(); stopPointerDrag() })

function children(layer: LayerInstance): LayerInstance[] {
  const ids = layer.getMetadata().childIds
  return Array.isArray(ids) ? ids.flatMap(id => typeof id === 'string' && app.layers.get(id) ? [app.layers.get(id)!] : []) : []
}
function leaves(layer: LayerInstance, seen = new Set<string>()): LayerInstance[] {
  if (seen.has(layer.id)) return []
  seen.add(layer.id)
  return layer.type === 'GROUP' ? children(layer).flatMap(child => leaves(child, seen)) : [layer]
}
const tree = computed(() => { void revision.value; void snapshot.value; return layerTree(app.layers.list()) })
function toggleSettings(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  expanded.value = next
}
function opacity(layer: LayerInstance) {
  void revision.value
  if (drafts.value[layer.id] !== undefined) return drafts.value[layer.id]!
  const values = leaves(layer).map(item => item.getMetadata().opacity)
  return values.length && values.every(value => typeof value === 'number' && Number.isFinite(value))
    ? values.every(value => value === values[0]) ? Math.round((values[0] as number) * 100) : null : undefined
}
function supportsOpacity(layer: LayerInstance) { return opacity(layer) !== undefined }
function clearDraft(id: string) {
  const next = { ...drafts.value }; delete next[id]; drafts.value = next
}
function changeOpacity(layer: LayerInstance, event: Event) {
  const value = Math.max(0, Math.min(100, Number((event.target as HTMLInputElement).value)))
  if (!Number.isFinite(value) || !supportsOpacity(layer)) return
  drafts.value = { ...drafts.value, [layer.id]: value }
  queued.set(layer.id, value)
  void flushOpacity(layer)
}
async function flushOpacity(layer: LayerInstance) {
  if (running.has(layer.id)) return
  running.add(layer.id)
  error.value = undefined
  try {
    while (!stopped && queued.has(layer.id) && app.layers.get(layer.id) === layer) {
      const value = queued.get(layer.id)!; queued.delete(layer.id)
      const targets = leaves(layer)
      const results = await Promise.allSettled(targets.map(target => app.layers.get(target.id) === target
        ? app.layers.update(target.id, { options: { opacity: value / 100 } }) : Promise.resolve()))
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failure) throw failure.reason
    }
  } catch (cause) {
    if (!stopped) error.value = cause instanceof Error ? cause.message : String(cause)
    queued.delete(layer.id)
  } finally {
    running.delete(layer.id)
    if (!stopped) clearDraft(layer.id)
  }
}
function toggleVisibility(layer: LayerInstance) {
  try { error.value = undefined; app.layers.setVisibility(layer.id, !layer.visible) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
}
function location(layer: LayerInstance) {
  void snapshot.value
  try { return app.layers.get(layer.id) === layer ? app.layers.getDataLocation(layer.id) : undefined }
  catch { return undefined }
}
function locate(layer: LayerInstance) {
  try {
    error.value = undefined
    const value = app.layers.get(layer.id) === layer ? app.layers.getDataLocation(layer.id) : undefined
    if (value) app.map.locate(value); else error.value = ui.locale.t('layer.noLocation')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
}
function move(layer: LayerInstance, direction: -1 | 1) {
  try { error.value = undefined; moveLayer(app.layers, layer, direction) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
}
function dragStart(event: DragEvent, layer: LayerInstance) {
  dragging.value = layer
  event.dataTransfer?.setData('text/plain', layer.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  const row = (event.currentTarget as HTMLElement).closest<HTMLElement>('.gis-ui-layer-row')
  if (row) event.dataTransfer?.setDragImage?.(row, 20, 20)
}
function dragOver(event: DragEvent, layer: LayerInstance) {
  if (!dragging.value || dragging.value === layer) return
  event.preventDefault()
  dropTarget.value = layer.id
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropAfter.value = event.clientY > bounds.top + bounds.height / 2
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}
function dragEnd() { dragging.value = undefined; dropTarget.value = undefined }
function drop(event: DragEvent, layer: LayerInstance) {
  if (!dragging.value) return
  event.preventDefault()
  try { error.value = undefined; reorderRootLayers(app.layers, dragging.value, layer, dropAfter.value) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  dragEnd()
}
function stopPointerDrag() {
  document.removeEventListener('pointermove', pointerMove)
  document.removeEventListener('pointerup', pointerUp)
  document.removeEventListener('pointercancel', cancelPointerDrag)
  window.removeEventListener('blur', cancelPointerDrag)
  pointerDrag = undefined
  dragEnd()
}
function cancelPointerDrag() { stopPointerDrag() }
function pointerDown(event: PointerEvent, layer: LayerInstance) {
  if (event.button !== 0) return
  event.preventDefault()
  stopPointerDrag()
  ;(event.currentTarget as HTMLButtonElement).focus()
  pointerDrag = { layer, id: event.pointerId, x: event.clientX, y: event.clientY }
  document.addEventListener('pointermove', pointerMove)
  document.addEventListener('pointerup', pointerUp)
  document.addEventListener('pointercancel', cancelPointerDrag)
  window.addEventListener('blur', cancelPointerDrag)
}
function pointerMove(event: PointerEvent) {
  if (!pointerDrag || event.pointerId !== pointerDrag.id) return
  if (!dragging.value && Math.hypot(event.clientX - pointerDrag.x, event.clientY - pointerDrag.y) < 5) return
  event.preventDefault()
  dragging.value = pointerDrag.layer
  const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.gis-ui-layer-row.is-root')
  const target = tree.value.find(node => row?.id === `${detailsId}-row-${node.layer.id}`)?.layer
  dropTarget.value = target && target !== dragging.value ? target.id : undefined
  if (row) { const bounds = row.getBoundingClientRect(); dropAfter.value = event.clientY > bounds.top + bounds.height / 2 }
}
function pointerUp(event: PointerEvent) {
  if (!pointerDrag || event.pointerId !== pointerDrag.id) return
  const target = tree.value.find(node => node.layer.id === dropTarget.value)?.layer
  try { if (dragging.value && target) reorderRootLayers(app.layers, dragging.value, target, dropAfter.value) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  stopPointerDrag()
}
</script>

<template>
  <div class="gis-ui-layer-manager">
    <p v-if="error" class="gis-ui-error" role="alert">{{ error }}</p>
    <p v-if="tree.length === 0" class="gis-ui-empty">{{ ui.locale.t('layer.empty') }}</p>
    <TransitionGroup v-else name="gis-ui-layer-sort" tag="ul" class="gis-ui-layer-list">
      <li v-for="row in tree" :key="row.layer.id" :id="detailsId + '-row-' + row.layer.id" class="gis-ui-layer-row is-root"
        :class="{ 'is-expanded': expanded.has(row.layer.id), 'is-dragging': dragging === row.layer, 'is-drop-before': dropTarget === row.layer.id && !dropAfter, 'is-drop-after': dropTarget === row.layer.id && dropAfter }"
        @dragover="dragOver($event, row.layer)" @drop="drop($event, row.layer)">
        <div class="gis-ui-layer-heading">
          <button type="button" class="gis-ui-layer-grip" draggable="true"
            :aria-label="`${ui.locale.t('layer.reorder')} ${row.layer.title || row.layer.id}`" :title="ui.locale.t('layer.reorderHint')"
            @pointerdown="pointerDown($event, row.layer)" @dragstart="dragStart($event, row.layer)" @dragend="dragEnd" @keydown.esc.prevent.stop="cancelPointerDrag" @keydown.up.prevent.stop="move(row.layer, -1)" @keydown.down.prevent.stop="move(row.layer, 1)">
            <SvgIcon name="grip-vertical" :size="14" />
          </button>
          <button type="button" class="gis-ui-icon-button gis-ui-layer-expand"
            :aria-label="ui.locale.t('layer.settings') + ' ' + (row.layer.title ?? row.layer.id)"
            :aria-expanded="expanded.has(row.layer.id)" :aria-controls="detailsId + '-' + row.layer.id"
            @click="toggleSettings(row.layer.id)">
            <SvgIcon :name="expanded.has(row.layer.id) ? 'chevron-up' : 'chevron-down'" :size="14" />
          </button>
          <button type="button" class="gis-ui-layer-visibility" :aria-label="ui.locale.t('action.toggleLayer') + ' ' + (row.layer.title ?? row.layer.id)" :aria-pressed="row.layer.visible" @click="toggleVisibility(row.layer)">
            <SvgIcon :name="row.layer.visible ? 'eye' : 'eye-off'" :size="16" />
          </button>
          <span class="gis-ui-layer-name" :title="row.layer.title ?? row.layer.id">{{ row.layer.title ?? row.layer.id }}</span>
          <Tooltip :content="ui.locale.t(location(row.layer) ? 'layer.locate' : 'layer.noLocation')" placement="bottom">
            <button type="button" class="gis-ui-icon-button gis-ui-layer-locate" :disabled="!snapshot.map.ready || !location(row.layer)" :aria-label="ui.locale.t('layer.locate') + ' ' + (row.layer.title ?? row.layer.id)" @click="locate(row.layer)">
              <SvgIcon name="send" :size="15" />
            </button>
          </Tooltip>
        </div>
        <div v-if="expanded.has(row.layer.id)" :id="detailsId + '-' + row.layer.id" class="gis-ui-layer-settings">
          <div class="gis-ui-layer-opacity" :title="supportsOpacity(row.layer) ? undefined : ui.locale.t('layer.opacityUnavailable')">
            <SvgIcon name="opacity" :size="16" :title="ui.locale.t('layer.opacity')" />
            <input :id="detailsId + '-opacity-' + row.layer.id" type="range" min="0" max="100" step="1" :style="{ '--gis-ui-opacity-progress': (opacity(row.layer) ?? 100) + '%' }"
              :value="opacity(row.layer) ?? 100" :disabled="!supportsOpacity(row.layer)"
              :aria-label="ui.locale.t('layer.opacity') + ' ' + (row.layer.title ?? row.layer.id)"
              :aria-valuetext="opacity(row.layer) === null ? ui.locale.t('layer.mixed') : (opacity(row.layer) ?? 100) + '%'"
              @input="changeOpacity(row.layer, $event)">
            <output>{{ opacity(row.layer) === null ? ui.locale.t('layer.mixed') : supportsOpacity(row.layer) ? opacity(row.layer) + '%' : '—' }}</output>
          </div>
          <LayerChildren v-if="row.children.length" :nodes="row.children" @toggle="toggleVisibility" />
        </div>
      </li>
    </TransitionGroup>
  </div>
</template>
