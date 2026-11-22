<script setup lang="ts">
import SvgIcon from './SvgIcon.vue'
import Tooltip from './Tooltip.vue'
defineProps<{ type: string; label: string }>()
</script>
<template>
  <Tooltip :content="label" placement="bottom"
    ><span class="gis-ui-legend-kind" tabindex="0"
      ><SvgIcon
        :name="
          type === 'category'
            ? 'legend-category'
            : type === 'interval'
              ? 'legend-interval'
              : type === 'continuous'
                ? 'scale'
                : 'layers'
        "
        :size="14"
        :title="label" /></span
  ></Tooltip>
</template>
