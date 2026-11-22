<script setup lang="ts">
import { ref, watch } from 'vue'
import type { BuiltinLayoutName } from '../types.js'

withDefaults(
  defineProps<{ layout: BuiltinLayoutName; rightVisible?: boolean; drawerVisible?: boolean }>(),
  {
    rightVisible: true,
    drawerVisible: false,
  }
)

const actions = ref<HTMLElement>()
const left = ref<HTMLElement>()
const top = ref<HTMLElement>()
const actionHeight = ref('48px')
watch(
  actions,
  (element, _, onCleanup) => {
    if (!element) return
    const update = () => {
      const height = element.getBoundingClientRect().height
      if (height) actionHeight.value = `${height}px`
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    onCleanup(() => observer.disconnect())
  },
  { flush: 'post' }
)
</script>

<template>
  <main
    class="gis-ui-layout"
    :class="layout === 'docked-dashboard' ? 'gis-ui-layout--docked' : 'gis-ui-layout--overlay'"
  >
    <header class="gis-ui-title"><slot name="title" /></header>
    <div
      v-if="layout === 'docked-dashboard'"
      class="gis-ui-workspace"
      :style="{ '--gis-ui-docked-actions-height': actionHeight }"
      :class="{ 'is-right-hidden': !rightVisible }"
    >
      <aside ref="left" class="gis-ui-left-region" />
      <div ref="actions" class="gis-ui-map-actions">
        <div ref="top" class="gis-ui-top-region" />
        <div class="gis-ui-toolbar-host" aria-label="Map tools"><slot name="toolbar" /></div>
      </div>
      <section class="gis-ui-map-region">
        <slot name="map" />
        <div class="gis-ui-overlay gis-ui-overlay--floating"><slot name="floating" /></div>
      </section>
      <aside
        class="gis-ui-right-region"
        :inert="!rightVisible || undefined"
        :aria-hidden="!rightVisible || undefined"
      >
        <slot name="right" />
      </aside>
      <footer class="gis-ui-map-status"><slot name="bottom" /></footer>
    </div>
    <section v-else class="gis-ui-map-region">
      <slot name="map" />
      <div class="gis-ui-overlay-controls" :class="{ 'has-drawer': drawerVisible }">
        <div ref="top" class="gis-ui-overlay--top" />
        <div class="gis-ui-overlay--toolbar" aria-label="Map tools"><slot name="toolbar" /></div>
        <div ref="left" class="gis-ui-overlay--left" />
        <div class="gis-ui-overlay--right"><slot name="right" /></div>
        <div class="gis-ui-overlay--drawer"><slot name="drawer" /></div>
        <div class="gis-ui-overlay--bottom"><slot name="bottom" /></div>
      </div>
      <div class="gis-ui-overlay gis-ui-overlay--floating"><slot name="floating" /></div>
    </section>
    <!-- Move the panels between layouts so their live controls and drafts survive. -->
    <Teleport :to="left" :disabled="!left"><slot name="left" /></Teleport>
    <Teleport :to="top" :disabled="!top"><slot name="top" /></Teleport>
  </main>
</template>
