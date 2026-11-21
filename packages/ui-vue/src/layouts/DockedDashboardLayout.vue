<script setup lang="ts">
import DashboardLayout from './DashboardLayout.vue'

withDefaults(defineProps<{ rightVisible?: boolean }>(), { rightVisible: true })
</script>

<template>
  <DashboardLayout layout="docked-dashboard" :right-visible="rightVisible">
    <template v-for="(_, name) in $slots" #[name]><slot :name="name" /></template>
  </DashboardLayout>
</template>
