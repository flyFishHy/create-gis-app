<script setup lang="ts">
import DashboardLayout from './DashboardLayout.vue';

withDefaults(defineProps<{ drawerVisible?: boolean }>(), { drawerVisible: false });
</script>

<template>
  <DashboardLayout layout="overlay-dashboard" :drawer-visible="drawerVisible">
    <template v-for="(_, name) in $slots" #[name]><slot :name="name" /></template>
  </DashboardLayout>
</template>
