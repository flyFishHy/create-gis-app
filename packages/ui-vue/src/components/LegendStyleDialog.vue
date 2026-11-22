<script setup lang="ts">
import { onMounted, ref, useId } from 'vue'
import LegendColor from './LegendColor.vue'
import LegendAction from './LegendAction.vue'
import type { UniformLayerStyle } from './legend-editor-types.js'

const props = defineProps<{
  layerStyle: UniformLayerStyle
  symbol?: string
  text: (key: string) => string
  blocked?: boolean
}>()
const emit = defineEmits<{ apply: [style: UniformLayerStyle]; close: [] }>()
const dialog = ref<HTMLDialogElement>()
const draft = ref({ ...props.layerStyle })
const originalFillPercent = (props.layerStyle.fillOpacity ?? 1) * 100
const fillPercent = ref(originalFillPercent)
const titleId = useId()

onMounted(() => {
  if (typeof dialog.value?.showModal === 'function') dialog.value.showModal()
  else dialog.value?.setAttribute('open', '')
})

function close() {
  dialog.value?.close?.()
  emit('close')
}

function apply() {
  if (props.blocked) return
  emit('apply', {
    ...draft.value,
    ...(fillPercent.value !== originalFillPercent ? { fillOpacity: fillPercent.value / 100 } : {}),
  })
  close()
}
</script>

<template>
  <dialog
    ref="dialog"
    class="gis-ui-legend-style-dialog"
    :aria-labelledby="titleId"
    @keydown.stop
    @cancel.prevent.stop="close"
  >
    <header class="gis-ui-legend-style-header">
      <h3 :id="titleId">{{ text('moreStyle') }}</h3>
      <LegendAction icon="close" :label="text('cancel')" @click="close" />
    </header>
    <form class="gis-ui-legend-style-form" @submit.prevent="apply">
      <label v-if="symbol !== 'line' && symbol !== 'circle'">
        <span>{{ text('fillOpacity') }}</span>
        <input v-model.number="fillPercent" type="number" min="0" max="100" step="any" required />
      </label>
      <div v-if="symbol !== 'line'" class="gis-ui-legend-style-field">
        <span>{{ text('strokeColor') }}</span>
        <LegendColor v-model="draft.strokeColor" :label="text('strokeColor')" />
      </div>
      <label>
        <span>{{ text(symbol === 'line' ? 'lineWidth' : 'strokeWidth') }}</span>
        <input v-model.number="draft.strokeWidth" type="number" min="0.01" step="any" required />
      </label>
      <label v-if="symbol !== 'circle'">
        <span>{{ text('lineDash') }}</span>
        <select
          :value="draft.lineDash ?? 'solid'"
          @change="
            draft.lineDash = ($event.target as HTMLSelectElement)
              .value as UniformLayerStyle['lineDash']
          "
        >
          <option value="solid">{{ text('solid') }}</option>
          <option value="dashed">{{ text('dashed') }}</option>
          <option value="dotted">{{ text('dotted') }}</option>
        </select>
      </label>
      <label v-if="symbol === 'line'">
        <span>{{ text('lineCap') }}</span>
        <select
          :value="draft.lineCap ?? 'round'"
          @change="
            draft.lineCap = ($event.target as HTMLSelectElement)
              .value as UniformLayerStyle['lineCap']
          "
        >
          <option value="round">{{ text('round') }}</option>
          <option value="butt">{{ text('butt') }}</option>
          <option value="square">{{ text('square') }}</option>
        </select>
      </label>
      <label v-if="symbol === 'circle'">
        <span>{{ text('pointRadius') }}</span>
        <input v-model.number="draft.pointRadius" type="number" min="0.01" step="any" required />
      </label>
      <footer>
        <button type="button" @click="close">{{ text('dismissStyle') }}</button>
        <button type="submit" :disabled="blocked">{{ text('applyStyle') }}</button>
      </footer>
    </form>
  </dialog>
</template>
