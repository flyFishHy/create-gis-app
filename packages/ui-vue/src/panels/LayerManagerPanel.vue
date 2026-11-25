<script setup lang="ts">
import PanelEmpty from '../components/PanelEmpty.vue';
import { computed, onBeforeUnmount, shallowRef, useId, watch } from 'vue';
import type { LayerInstance } from '@joinmap/gis-core';
import { useGISApp } from '../use-gis-app.js';
import { useGISUI } from '../use-gis-ui.js';
import SvgIcon from '../components/SvgIcon.vue';
import Tooltip from '../components/Tooltip.vue';
import { filterLayerTree, layerTree, moveLayer, reorderRootLayers } from './layer-tree.js';
import { usePanelHeader } from '../use-panel-header.js';
import LayerChildren from './LayerChildren.vue';
import { useAppState } from '../use-app-state.js';

const app = useGISApp();
const ui = useGISUI();
const snapshot = useAppState((state) => state.layers);
const mapReady = useAppState((state) => state.map.ready);
const dragging = shallowRef<LayerInstance>();
const dropTarget = shallowRef<string>();
const dropAfter = shallowRef(false);
const revision = shallowRef(0);
const keyword = shallowRef('');
const expanded = shallowRef(new Set<string>());
const drafts = shallowRef<Record<string, number>>({});
const error = shallowRef<string>();
const detailsId = useId();
const queued = new Map<string, number>();
const running = new Set<string>();
let stopped = false;
let pointerDrag: { layer: LayerInstance; id: number; x: number; y: number } | undefined;
const stop = app.layers.subscribe((event) => {
  revision.value++;
  if (event.type === 'remove' && event.id) {
    queued.delete(event.id);
    const next = new Set(expanded.value);
    next.delete(event.id);
    expanded.value = next;
  }
});
onBeforeUnmount(() => {
  stopped = true;
  queued.clear();
  stop();
  stopPointerDrag();
});

function children(layer: LayerInstance): LayerInstance[] {
  const ids = layer.getMetadata().childIds;
  return Array.isArray(ids)
    ? ids.flatMap((id) =>
        typeof id === 'string' && app.layers.get(id) ? [app.layers.get(id)!] : []
      )
    : [];
}
function leaves(layer: LayerInstance, seen = new Set<string>()): LayerInstance[] {
  if (seen.has(layer.id)) {
    return [];
  }
  seen.add(layer.id);
  return layer.type === 'GROUP' ? children(layer).flatMap((child) => leaves(child, seen)) : [layer];
}
const tree = computed(() => {
  void revision.value;
  void snapshot.value;
  return layerTree(app.layers.list());
});
const filteredTree = computed(() => filterLayerTree(tree.value, keyword.value));
const animateReorder = shallowRef(false);
watch(
  () => filteredTree.value.map((row) => row.layer.id),
  (ids, previous) => {
    const previousIds = new Set(previous);
    animateReorder.value =
      ids.length === previous.length &&
      ids.every((id) => previousIds.has(id)) &&
      ids.some((id, index) => id !== previous[index]);
  }
);
const count = computed(
  () => `${tree.value.filter((row) => row.layer.visible).length}/${tree.value.length}`
);
usePanelHeader(count, () => {
  keyword.value = '';
  error.value = undefined;
  revision.value++;
});
function isExpanded(id: string) {
  return expanded.value.has(id) || !!keyword.value.trim();
}
function toggleSettings(id: string) {
  // Moving rows from their old positions would keep the collapsed height in the scrollable overflow.
  animateReorder.value = false;
  const next = new Set(expanded.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  expanded.value = next;
}
function opacity(layer: LayerInstance) {
  void revision.value;
  if (drafts.value[layer.id] !== undefined) {
    return drafts.value[layer.id]!;
  }
  const values = leaves(layer).map((item) => item.getMetadata().opacity);
  return values.length &&
    values.every((value) => typeof value === 'number' && Number.isFinite(value))
    ? values.every((value) => value === values[0])
      ? Math.round((values[0] as number) * 100)
      : null
    : undefined;
}
function supportsOpacity(layer: LayerInstance) {
  return opacity(layer) !== undefined;
}
function clearDraft(id: string) {
  const next = { ...drafts.value };
  delete next[id];
  drafts.value = next;
}
function changeOpacity(layer: LayerInstance, event: Event) {
  const value = Math.max(0, Math.min(100, Number((event.target as HTMLInputElement).value)));
  if (!Number.isFinite(value) || !supportsOpacity(layer)) {
    return;
  }
  drafts.value = { ...drafts.value, [layer.id]: value };
  queued.set(layer.id, value);
  void flushOpacity(layer);
}
async function flushOpacity(layer: LayerInstance) {
  if (running.has(layer.id)) {
    return;
  }
  running.add(layer.id);
  error.value = undefined;
  try {
    while (!stopped && queued.has(layer.id) && app.layers.get(layer.id) === layer) {
      const value = queued.get(layer.id)!;
      queued.delete(layer.id);
      const targets = leaves(layer);
      const results = await Promise.allSettled(
        targets.map((target) =>
          app.layers.get(target.id) === target
            ? app.layers.update(target.id, { options: { opacity: value / 100 } })
            : Promise.resolve()
        )
      );
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      if (failure) {
        throw failure.reason;
      }
    }
  } catch (cause) {
    if (!stopped) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
    queued.delete(layer.id);
  } finally {
    running.delete(layer.id);
    if (!stopped) {
      clearDraft(layer.id);
    }
  }
}
function toggleVisibility(layer: LayerInstance) {
  try {
    error.value = undefined;
    app.layers.setVisibility(layer.id, !layer.visible);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}
function location(layer: LayerInstance) {
  void snapshot.value;
  try {
    return app.layers.get(layer.id) === layer ? app.layers.getDataLocation(layer.id) : undefined;
  } catch {
    return undefined;
  }
}
function locate(layer: LayerInstance) {
  try {
    error.value = undefined;
    const value =
      app.layers.get(layer.id) === layer ? app.layers.getDataLocation(layer.id) : undefined;
    if (value) {
      app.map.locate(value);
    } else {
      error.value = ui.locale.t('layer.noLocation');
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}
function move(layer: LayerInstance, direction: -1 | 1) {
  try {
    error.value = undefined;
    moveLayer(app.layers, layer, direction);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}
function dragStart(event: DragEvent, layer: LayerInstance) {
  dragging.value = layer;
  event.dataTransfer?.setData('text/plain', layer.id);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
  const row = (event.currentTarget as HTMLElement).closest<HTMLElement>('.gis-ui-layer-row');
  if (row) {
    event.dataTransfer?.setDragImage?.(row, 20, 20);
  }
}
function dragOver(event: DragEvent, layer: LayerInstance) {
  if (!dragging.value || dragging.value === layer) {
    return;
  }
  event.preventDefault();
  dropTarget.value = layer.id;
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  dropAfter.value = event.clientY > bounds.top + bounds.height / 2;
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}
function dragEnd() {
  dragging.value = undefined;
  dropTarget.value = undefined;
}
function drop(event: DragEvent, layer: LayerInstance) {
  if (!dragging.value) {
    return;
  }
  event.preventDefault();
  try {
    error.value = undefined;
    reorderRootLayers(app.layers, dragging.value, layer, dropAfter.value);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
  dragEnd();
}
function stopPointerDrag() {
  document.removeEventListener('pointermove', pointerMove);
  document.removeEventListener('pointerup', pointerUp);
  document.removeEventListener('pointercancel', cancelPointerDrag);
  window.removeEventListener('blur', cancelPointerDrag);
  pointerDrag = undefined;
  dragEnd();
}
function cancelPointerDrag() {
  stopPointerDrag();
}
function pointerDown(event: PointerEvent, layer: LayerInstance) {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  stopPointerDrag();
  (event.currentTarget as HTMLButtonElement).focus();
  pointerDrag = { layer, id: event.pointerId, x: event.clientX, y: event.clientY };
  document.addEventListener('pointermove', pointerMove);
  document.addEventListener('pointerup', pointerUp);
  document.addEventListener('pointercancel', cancelPointerDrag);
  window.addEventListener('blur', cancelPointerDrag);
}
function pointerMove(event: PointerEvent) {
  if (!pointerDrag || event.pointerId !== pointerDrag.id) {
    return;
  }
  if (
    !dragging.value &&
    Math.hypot(event.clientX - pointerDrag.x, event.clientY - pointerDrag.y) < 5
  ) {
    return;
  }
  event.preventDefault();
  dragging.value = pointerDrag.layer;
  const row = document
    .elementFromPoint(event.clientX, event.clientY)
    ?.closest<HTMLElement>('.gis-ui-layer-row.is-root');
  const target = tree.value.find((node) => row?.id === `${detailsId}-row-${node.layer.id}`)?.layer;
  dropTarget.value = target && target !== dragging.value ? target.id : undefined;
  if (row) {
    const bounds = row.getBoundingClientRect();
    dropAfter.value = event.clientY > bounds.top + bounds.height / 2;
  }
}
function pointerUp(event: PointerEvent) {
  if (!pointerDrag || event.pointerId !== pointerDrag.id) {
    return;
  }
  const target = tree.value.find((node) => node.layer.id === dropTarget.value)?.layer;
  try {
    if (dragging.value && target) {
      reorderRootLayers(app.layers, dragging.value, target, dropAfter.value);
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
  stopPointerDrag();
}
</script>

<template>
  <div class="gis-ui-layer-manager">
    <div class="gis-ui-layer-search">
      <SvgIcon name="search" :size="14" /><input
        v-model="keyword"
        type="search"
        :aria-label="ui.locale.t('layer.search')"
        :placeholder="ui.locale.t('layer.search')"
        @keydown.esc.stop="keyword = ''"
      /><button
        v-if="keyword"
        type="button"
        :aria-label="ui.locale.t('layer.clearSearch')"
        @click="keyword = ''"
      >
        <SvgIcon name="close" :size="13" />
      </button>
    </div>
    <p v-if="error" class="gis-ui-error" role="alert">{{ error }}</p>
    <PanelEmpty
      v-if="tree.length === 0"
      icon="layers"
      :title="ui.locale.t('layer.empty')"
      :description="ui.locale.t('layer.emptyDescription')"
    />
    <p v-else-if="!filteredTree.length" class="gis-ui-empty">
      {{ ui.locale.t('layer.noMatches') }}
    </p>
    <TransitionGroup
      v-else
      name="gis-ui-layer-sort"
      tag="ul"
      class="gis-ui-layer-list"
      :move-class="animateReorder ? 'gis-ui-layer-sort-move' : 'gis-ui-layer-sort-static'"
    >
      <li
        v-for="row in filteredTree"
        :key="row.layer.id"
        :id="detailsId + '-row-' + row.layer.id"
        class="gis-ui-layer-row is-root"
        :class="{
          'is-hidden': !row.layer.visible,
          'is-expanded': isExpanded(row.layer.id),
          'is-dragging': dragging === row.layer,
          'is-drop-before': dropTarget === row.layer.id && !dropAfter,
          'is-drop-after': dropTarget === row.layer.id && dropAfter,
        }"
        @dragover="dragOver($event, row.layer)"
        @drop="drop($event, row.layer)"
      >
        <div class="gis-ui-layer-heading">
          <button
            type="button"
            class="gis-ui-layer-visibility"
            :aria-label="
              ui.locale.t('action.toggleLayer') + ' ' + (row.layer.title ?? row.layer.id)
            "
            :aria-pressed="row.layer.visible"
            @click="toggleVisibility(row.layer)"
          >
            <SvgIcon :name="row.layer.visible ? 'eye' : 'eye-off'" :size="16" />
          </button>
          <span class="gis-ui-layer-name" :title="row.layer.title ?? row.layer.id">{{
            row.layer.title ?? row.layer.id
          }}</span>
          <button
            type="button"
            class="gis-ui-layer-grip"
            draggable="true"
            :aria-label="`${ui.locale.t('layer.reorder')} ${row.layer.title || row.layer.id}`"
            :title="ui.locale.t('layer.reorderHint')"
            @pointerdown="pointerDown($event, row.layer)"
            @dragstart="dragStart($event, row.layer)"
            @dragend="dragEnd"
            @keydown.esc.prevent.stop="cancelPointerDrag"
            @keydown.up.prevent.stop="move(row.layer, -1)"
            @keydown.down.prevent.stop="move(row.layer, 1)"
          >
            <SvgIcon name="grip-vertical" :size="15" />
          </button>
          <Tooltip
            :content="ui.locale.t(location(row.layer) ? 'layer.locate' : 'layer.noLocation')"
            placement="bottom"
          >
            <button
              type="button"
              class="gis-ui-icon-button gis-ui-layer-locate"
              :disabled="!mapReady || !location(row.layer)"
              :aria-label="ui.locale.t('layer.locate') + ' ' + (row.layer.title ?? row.layer.id)"
              @click="locate(row.layer)"
            >
              <SvgIcon name="layer-locate" :size="15" />
            </button>
          </Tooltip>
          <button
            type="button"
            class="gis-ui-icon-button gis-ui-layer-expand"
            :aria-label="ui.locale.t('layer.settings') + ' ' + (row.layer.title ?? row.layer.id)"
            :aria-expanded="isExpanded(row.layer.id)"
            :aria-controls="detailsId + '-' + row.layer.id"
            @click="toggleSettings(row.layer.id)"
          >
            <SvgIcon name="chevron-down" :size="15" />
          </button>
        </div>
        <div
          v-if="isExpanded(row.layer.id)"
          :id="detailsId + '-' + row.layer.id"
          class="gis-ui-layer-settings"
        >
          <div
            class="gis-ui-layer-opacity"
            :title="
              supportsOpacity(row.layer) ? undefined : ui.locale.t('layer.opacityUnavailable')
            "
          >
            <SvgIcon name="opacity" :size="16" :title="ui.locale.t('layer.opacity')" />
            <input
              :id="detailsId + '-opacity-' + row.layer.id"
              type="range"
              min="0"
              max="100"
              step="1"
              :style="{ '--gis-ui-opacity-progress': (opacity(row.layer) ?? 100) + '%' }"
              :value="opacity(row.layer) ?? 100"
              :disabled="!supportsOpacity(row.layer)"
              :aria-label="ui.locale.t('layer.opacity') + ' ' + (row.layer.title ?? row.layer.id)"
              :aria-valuetext="
                opacity(row.layer) === null
                  ? ui.locale.t('layer.mixed')
                  : (opacity(row.layer) ?? 100) + '%'
              "
              @input="changeOpacity(row.layer, $event)"
            />
            <output>{{ opacity(row.layer) != null ? opacity(row.layer) + '%' : '—' }}</output>
          </div>
          <LayerChildren
            v-if="row.children.length"
            :nodes="row.children"
            @toggle="toggleVisibility"
          />
        </div>
      </li>
    </TransitionGroup>
  </div>
</template>
