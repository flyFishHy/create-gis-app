<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, useId } from 'vue'
import type { LayerInstance } from '@joinmap/gis-core'
import { useGISApp } from '../use-gis-app.js'
import { useGISUI } from '../use-gis-ui.js'
import SvgIcon from '../components/SvgIcon.vue'
import Tooltip from '../components/Tooltip.vue'

interface LayerNode { layer: LayerInstance; depth: number; group: boolean }
const app = useGISApp()
const ui = useGISUI()
const revision = shallowRef(0)
const expanded = shallowRef(new Set<string>())
const drafts = shallowRef<Record<string, number>>({})
const error = shallowRef<string>()
const detailsId = useId()
const queued = new Map<string, number>()
const running = new Set<string>()
let stopped = false
const stop = app.layers.subscribe(event => {
  revision.value++
  if (event.type === 'remove' && event.id) {
    queued.delete(event.id)
    const next = new Set(expanded.value); next.delete(event.id); expanded.value = next
  }
})
onBeforeUnmount(() => { stopped = true; queued.clear(); stop() })

function children(layer: LayerInstance): LayerInstance[] {
  const ids = layer.getMetadata().childIds
  return Array.isArray(ids) ? ids.flatMap(id => typeof id === 'string' && app.layers.get(id) ? [app.layers.get(id)!] : []) : []
}
function leaves(layer: LayerInstance, seen = new Set<string>()): LayerInstance[] {
  if (seen.has(layer.id)) return []
  seen.add(layer.id)
  return layer.type === 'GROUP' ? children(layer).flatMap(child => leaves(child, seen)) : [layer]
}
const rows = computed(() => {
  void revision.value
  const instances = app.layers.list(), childIds = new Set<string>()
  for (const layer of instances) if (layer.type === 'GROUP') children(layer).forEach(child => childIds.add(child.id))
  const result: LayerNode[] = []
  const append = (layer: LayerInstance, depth: number) => {
    const group = layer.type === 'GROUP'
    result.push({ layer, depth, group })
    if (group) children(layer).forEach(child => append(child, depth + 1))
  }
  instances.filter(layer => !childIds.has(layer.id)).forEach(layer => append(layer, 0))
  return result
})
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
</script>

<template>
  <div class="gis-ui-layer-manager">
    <p v-if="error" class="gis-ui-error" role="alert">{{ error }}</p>
    <p v-if="rows.length === 0" class="gis-ui-empty">{{ ui.locale.t('layer.empty') }}</p>
    <ul v-else class="gis-ui-layer-list">
      <li v-for="row in rows" :key="row.layer.id" class="gis-ui-layer-row" :class="{ 'is-expanded': expanded.has(row.layer.id) }" :style="{ marginLeft: row.depth * 12 + 'px' }">
        <div class="gis-ui-layer-heading">
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
          <Tooltip :content="ui.locale.t('layer.locatePending')" placement="bottom">
            <button type="button" class="gis-ui-icon-button gis-ui-layer-locate" disabled :aria-label="ui.locale.t('layer.locate') + ' ' + (row.layer.title ?? row.layer.id)">
              <SvgIcon name="send" :size="15" />
            </button>
          </Tooltip>
        </div>
        <div v-if="expanded.has(row.layer.id)" :id="detailsId + '-' + row.layer.id" class="gis-ui-layer-settings">
          <div class="gis-ui-layer-opacity" :title="supportsOpacity(row.layer) ? undefined : ui.locale.t('layer.opacityUnavailable')">
            <SvgIcon name="opacity" :size="16" />
            <label :for="detailsId + '-opacity-' + row.layer.id">{{ ui.locale.t('layer.opacity') }}</label>
            <input :id="detailsId + '-opacity-' + row.layer.id" type="range" min="0" max="100" step="1"
              :value="opacity(row.layer) ?? 100" :disabled="!supportsOpacity(row.layer)"
              :aria-label="ui.locale.t('layer.opacity') + ' ' + (row.layer.title ?? row.layer.id)"
              :aria-valuetext="opacity(row.layer) === null ? ui.locale.t('layer.mixed') : (opacity(row.layer) ?? 100) + '%'"
              @input="changeOpacity(row.layer, $event)">
            <output>{{ opacity(row.layer) === null ? ui.locale.t('layer.mixed') : supportsOpacity(row.layer) ? opacity(row.layer) + '%' : '—' }}</output>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
