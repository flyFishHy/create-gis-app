<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue';
import type { FeaturePickCandidate, FeaturePickState } from '@joinmap/gis-core';
import { useAppState } from '../use-app-state.js';
import { useGISApp } from '../use-gis-app.js';
import { useGISUI } from '../use-gis-ui.js';
import SvgIcon from './SvgIcon.vue';

const app = useGISApp();
const ui = useGISUI();
const id = useId();
const pick = shallowRef<FeaturePickState>();
const layers = useAppState((snapshot) => snapshot.layers);
const overlay = ref<HTMLElement>();
const surface = ref<HTMLElement>();
const nativeTarget = shallowRef<HTMLElement>();
const position = shallowRef({ left: '0px', top: '0px', '--gis-ui-map-popup-anchor-x': '50%' });
const tailSide = ref<'top' | 'bottom'>();
let unregister: (() => void) | undefined;
let removeNativePopup: (() => void) | undefined;

onMounted(() => {
  unregister = app.interactions.registerFeaturePicker((value) => {
    pick.value = value;
  });
});
onBeforeUnmount(() => {
  unregister?.();
  removeNativePopup?.();
});

watch(
  () => pick.value?.anchor,
  (anchor) => {
    removeNativePopup?.();
    removeNativePopup = undefined;
    nativeTarget.value = undefined;
    if (!anchor || !app.map.isReady) {
      return;
    }
    const element = document.createElement('div');
    element.className = 'gis-ui-feature-picker-native';
    removeNativePopup = app.map.addPopupOverlay(element, anchor);
    if (removeNativePopup) {
      nativeTarget.value = element;
    }
  },
  { flush: 'sync' }
);

watch(
  pick,
  (value) => {
    const host = overlay.value,
      panel = surface.value;
    if (!value || !host || !panel) {
      return;
    }
    if (!nativeTarget.value) {
      const [pixelX, pixelY] = value.pixel;
      const gap = 8;
      const { offsetWidth: width, offsetHeight: height } = panel;
      const clamp = (coordinate: number, available: number, size: number) =>
        Math.max(0, Math.min(coordinate, available - size));
      const left = clamp(pixelX - width / 2, host.clientWidth, width);
      const above = pixelY - gap - height;
      const top = clamp(
        above >= 0 || pixelY > host.clientHeight / 2 ? above : pixelY + gap,
        host.clientHeight,
        height
      );
      position.value = {
        left: `${left}px`,
        top: `${top}px`,
        '--gis-ui-map-popup-anchor-x': `${pixelX - left}px`,
      };
      tailSide.value = top >= pixelY ? 'top' : top + height <= pixelY ? 'bottom' : undefined;
    }
    if (value.status === 'choices') {
      panel
        .querySelector<HTMLButtonElement>('.gis-ui-feature-picker-choice')
        ?.focus({ preventScroll: true });
    }
  },
  { flush: 'post' }
);

function title(candidate: FeaturePickCandidate, index: number): string {
  const label = [
    candidate.title,
    candidate.properties?.name,
    candidate.properties?.title,
    candidate.properties?.label,
    candidate.id,
  ].find((value) => (typeof value === 'string' && value.trim()) || typeof value === 'number');
  return label === undefined
    ? `${ui.locale.t('featurePicker.untitled')} ${index + 1}`
    : String(label);
}

function focusMap() {
  overlay.value?.parentElement
    ?.querySelector<HTMLElement>('.gis-ui-map-viewport')
    ?.focus({ preventScroll: true });
}

function cancel() {
  focusMap();
  app.interactions.cancelFeaturePick();
}

function choose(candidate: FeaturePickCandidate) {
  if (pick.value?.status !== 'choices' || !pick.value.candidates.includes(candidate)) {
    return;
  }
  focusMap();
  const { title: _title, ...feature } = candidate;
  app.interactions.select({ feature });
}
</script>

<template>
  <div v-if="pick" ref="overlay" class="gis-ui-feature-picker-overlay">
    <Teleport :to="nativeTarget ?? 'body'" :disabled="!nativeTarget">
      <section
        ref="surface"
        class="gis-ui-feature-picker"
        :class="{ 'gis-ui-feature-picker-notice': pick.status !== 'choices' }"
        :role="pick.status === 'choices' ? 'dialog' : undefined"
        :aria-labelledby="pick.status === 'choices' ? id : undefined"
        :style="nativeTarget ? undefined : position"
        v-bind="{ 'data-popup-tail': nativeTarget ? undefined : tailSide }"
        @pointerdown.stop
        @click.stop
        @dblclick.stop
        @wheel.stop
        @keydown.esc.stop.prevent="cancel"
      >
        <span class="gis-ui-feature-picker-surface" aria-hidden="true" />
        <header>
          <strong v-if="pick.status === 'choices'" :id="id"
            >{{ ui.locale.t('featurePicker.title') }} ({{ pick.candidates.length }})</strong
          >
          <span v-else role="status">{{
            ui.locale.t(
              pick.status === 'loading' ? 'featurePicker.loading' : 'featurePicker.failed'
            )
          }}</span>
          <button
            type="button"
            class="gis-ui-feature-picker-close"
            :aria-label="ui.locale.t('editor.cancel')"
            @click="cancel"
          >
            <SvgIcon name="close" :size="14" />
          </button>
        </header>
        <p v-if="pick.status === 'choices' && pick.incomplete" role="status">
          {{ ui.locale.t('featurePicker.failed') }}
        </p>
        <ul v-if="pick.status === 'choices'">
          <li v-for="(candidate, index) in pick.candidates" :key="index">
            <button type="button" class="gis-ui-feature-picker-choice" @click="choose(candidate)">
              <span>{{ title(candidate, index) }}</span>
              <small>{{
                layers.find((layer) => layer.id === candidate.layerId)?.title || candidate.layerId
              }}</small>
            </button>
          </li>
        </ul>
      </section>
    </Teleport>
  </div>
</template>
