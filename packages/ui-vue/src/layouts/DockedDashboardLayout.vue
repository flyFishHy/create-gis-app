<script setup lang="ts">
withDefaults(defineProps<{ rightVisible?: boolean }>(), { rightVisible: true })
</script>

<template>
  <main class="gis-ui-layout gis-ui-layout--docked">
    <header class="gis-ui-title"><slot name="title" /></header>
    <div class="gis-ui-workspace" :class="{ 'is-right-hidden': !rightVisible }">
      <aside class="gis-ui-left-region">
        <slot name="left" />
      </aside>
      <div class="gis-ui-map-actions">
        <div class="gis-ui-top-region"><slot name="top" /></div>
        <div class="gis-ui-toolbar-host" aria-label="Map tools"><slot name="toolbar" /></div>
      </div>
      <section class="gis-ui-map-region">
        <slot name="map" />
        <div class="gis-ui-overlay gis-ui-overlay--floating"><slot name="floating" /></div>
      </section>
      <aside class="gis-ui-right-region"><slot name="right" /></aside>
      <footer class="gis-ui-map-status"><slot name="bottom" /></footer>
    </div>
  </main>
</template>
