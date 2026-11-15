<script setup lang="ts">
withDefaults(defineProps<{ drawerVisible?: boolean }>(), { drawerVisible: false })
</script>

<template>
  <main class="gis-ui-layout gis-ui-layout--overlay">
    <header class="gis-ui-title"><slot name="title" /></header>
    <section class="gis-ui-map-region">
      <slot name="map" />
      <div class="gis-ui-overlay-controls" :class="{ 'has-drawer': drawerVisible }">
        <div class="gis-ui-overlay--top"><slot name="top" /></div>
        <div class="gis-ui-overlay--toolbar" aria-label="Map tools"><slot name="toolbar" /></div>
        <div class="gis-ui-overlay--left"><slot name="left" /></div>
        <div class="gis-ui-overlay--right"><slot name="right" /></div>
        <div class="gis-ui-overlay--drawer"><slot name="drawer" /></div>
        <div class="gis-ui-overlay--bottom"><slot name="bottom" /></div>
      </div>
      <div class="gis-ui-overlay gis-ui-overlay--floating"><slot name="floating" /></div>
    </section>
  </main>
</template>
