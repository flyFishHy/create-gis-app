<script setup lang="ts">
import { computed } from 'vue';
import type { LayerInstance } from '@joinmap/gis-core';
import { useGISUI } from '../../use-gis-ui.js';
import LegendEditor from '../../components/LegendEditor.vue';
import { useLayerEditSession } from './use-layer-edit-session.js';
import { layerSymbol } from './layer-symbol.js';

const props = defineProps<{ layer: LayerInstance }>();
const emit = defineEmits<{ close: [] }>();
const ui = useGISUI();
const { alive, conflict, base, saving, error, editorKey, reload, submit } = useLayerEditSession(
  props.layer,
  () => emit('close')
);
const keys = [
  'type',
  'generate',
  'generationEmpty',
  'generationLimit',
  'title',
  'item',
  'color',
  'category',
  'interval',
  'continuous',
  'image',
  'field',
  'value',
  'default',
  'layerColor',
  'add',
  'remove',
  'save',
  'cancel',
  'invalid',
  'min',
  'max',
  'uniform',
  'search',
  'clear',
  'empty',
  'missing',
  'used',
  'inclusive',
  'more',
  'moreStyle',
  'fillOpacity',
  'strokeColor',
  'strokeWidth',
  'lineWidth',
  'lineDash',
  'lineCap',
  'pointRadius',
  'solid',
  'dashed',
  'dotted',
  'round',
  'butt',
  'square',
  'dismissStyle',
  'applyStyle',
];
const labels = computed(() => ({
  ...Object.fromEntries(keys.map((key) => [key, ui.locale.t(`editor.${key}`)])),
  cancel: ui.locale.t('editor.close'),
}));
</script>

<template>
  <div class="gis-ui-layer-editor">
    <p v-if="!alive" class="gis-ui-error" role="alert">
      {{ ui.locale.t('editor.removed')
      }}<button type="button" @click="emit('close')">{{ ui.locale.t('editor.cancel') }}</button>
    </p>
    <template v-else>
      <div v-if="conflict && !saving" class="gis-ui-editor-conflict" role="alert">
        {{ ui.locale.t('editor.conflict')
        }}<button type="button" @click="reload">{{ ui.locale.t('editor.reload') }}</button>
      </div>
      <LegendEditor
        :key="editorKey"
        :legend="base.legend"
        :layer-style="base.style"
        :title="layer.title || layer.id"
        :fields="layer.getFields()"
        :get-field-values="(field) => layer.getFieldValues(field)"
        :symbol="layerSymbol(layer.getMetadata().geometryType)"
        :labels="labels"
        :saving="saving"
        :blocked="conflict"
        :error="error"
        @submit="submit"
        @cancel="emit('close')"
      />
    </template>
  </div>
</template>
