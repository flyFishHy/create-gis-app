<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import {
  parseGISAppConfig,
  type LayerField,
  type LayerLegend,
  type LegendItem,
  type LegendRange,
  type LegendValue,
} from '@joinmap/gis-core';
import type { LegendEditValue, UniformLayerStyle } from './legend-editor-types.js';
import { selectValueKey } from './select-values.js';
import LegendColor from './LegendColor.vue';
import LegendAction from './LegendAction.vue';
import LegendStyleDialog from './LegendStyleDialog.vue';
import GisSelect from './GisSelect.vue';
import GisMultiSelect from './GisMultiSelect.vue';
import SvgIcon from './SvgIcon.vue';

defineOptions({ inheritAttrs: false });
const props = defineProps<{
  legend?: LayerLegend;
  layerStyle?: UniformLayerStyle;
  fields?: readonly LayerField[];
  getFieldValues?: (field: string) => readonly LegendValue[];
  symbol?: string;
  title?: string;
  saving?: boolean;
  blocked?: boolean;
  error?: string;
  labels?: Readonly<Record<string, string>>;
}>();
const emit = defineEmits<{ submit: [value: LegendEditValue]; cancel: [] }>();
const defaults: Record<string, string> = {
  title: 'Legend',
  color: 'Color',
  category: 'Category',
  interval: 'Interval',
  continuous: 'Continuous',
  image: 'Image',
  field: 'Metric',
  value: 'Matching values',
  item: 'Label',
  default: 'Unmatched values',
  layerColor: 'Layer color',
  add: 'Add rule',
  remove: 'Delete',
  save: 'Save',
  cancel: 'Close',
  invalid: 'Check matching values, non-overlapping intervals and valid colors.',
  min: 'Minimum',
  max: 'Maximum',
  uniform: 'No classification',
  search: 'Search values',
  clear: 'Clear selection',
  empty: 'No matching values',
  missing: 'Not in current data',
  used: 'Used by',
  inclusive: 'Include upper boundary',
  more: 'More',
  moreStyle: 'Advanced layer style',
  fillOpacity: 'Fill opacity (%)',
  strokeColor: 'Outline color',
  strokeWidth: 'Outline width (px)',
  lineWidth: 'Line width (px)',
  lineDash: 'Line pattern',
  lineCap: 'Line cap',
  pointRadius: 'Point radius (px)',
  solid: 'Solid',
  dashed: 'Dashed',
  dotted: 'Dotted',
  round: 'Round',
  butt: 'Flat',
  square: 'Square',
  dismissStyle: 'Cancel',
  applyStyle: 'Apply to draft',
  type: 'Classification type',
  generate: 'Generate rules',
  generationEmpty: 'This field has no suitable values.',
  generationLimit: 'Use a field with at most 12 different values, or add rules manually.',
};
const text = (key: string) => props.labels?.[key] ?? defaults[key] ?? key;
const uid = useId();
let sequence = 0;
function copyLegend(): LayerLegend {
  const copy = JSON.parse(
    JSON.stringify(props.legend ?? { type: 'category', items: [] })
  ) as LayerLegend;
  return {
    ...copy,
    ...(copy.items
      ? {
          items: copy.items.map(({ value, ...item }) =>
            value === undefined ? item : { ...item, values: [value] }
          ),
        }
      : {}),
  };
}
const draft = ref(copyLegend());
const style = ref<UniformLayerStyle>({
  fillColor: '#ffffff66',
  strokeColor: '#3399cc',
  strokeWidth: 1.25,
  pointRadius: 5,
  ...props.layerStyle,
});
const advanced = ref(false);
const validation = ref(''),
  candidates = ref<readonly LegendValue[]>([]);
const items = computed(() => draft.value.items ?? []);
const ranges = computed(() => draft.value.ranges ?? []);
const classified = computed(
  () => !!draft.value.field && (draft.value.type === 'category' || draft.value.type === 'interval')
);
const uniform = computed(() => !draft.value.field && draft.value.type === 'category');
const convertingToUniform = computed(() => uniform.value && !!props.legend?.field);
const colorLabel = computed(() => (classified.value ? text('default') : text('layerColor')));
const defaultColor = computed({
  get: () => (props.symbol === 'line' ? style.value.strokeColor : style.value.fillColor),
  set: (color) => {
    if (props.symbol === 'line') {
      style.value.strokeColor = color;
    } else {
      style.value.fillColor = color;
    }
  },
});
const fields = computed(() =>
  (props.fields ?? []).filter((field) => draft.value.type !== 'interval' || field.type === 'number')
);
const typeOptions = computed(() => [
  { value: 'category', label: text('category') },
  { value: 'interval', label: text('interval') },
]);
const fieldOptions = computed(() => {
  const choices = fields.value.map((field) => ({ value: field.name, label: field.name }));
  if (draft.value.field && !choices.some((field) => field.value === draft.value.field)) {
    choices.unshift({ value: draft.value.field, label: draft.value.field });
  }
  if (draft.value.type === 'category') {
    choices.unshift({ value: '', label: text('uniform') });
  }
  return choices;
});
function refreshValues() {
  try {
    candidates.value = draft.value.field ? (props.getFieldValues?.(draft.value.field) ?? []) : [];
  } catch {
    candidates.value = [];
    validation.value = text('invalid');
  }
}
function options(index: number) {
  const used = new Map(
    items.value.flatMap((item, itemIndex) =>
      itemIndex === index
        ? []
        : (item.values ?? []).map(
            (value) => [selectValueKey(value), item.label || item.id] as const
          )
    )
  );
  return candidates.value.map((value) => ({
    value,
    label: String(value) || '""',
    disabled: used.has(selectValueKey(value)),
    hint: used.has(selectValueKey(value))
      ? `${text('used')}: ${used.get(selectValueKey(value))}`
      : undefined,
  }));
}
function setField(field: string) {
  draft.value = { ...draft.value, field: field || undefined, useLayerStyle: false };
  validation.value = '';
  refreshValues();
}
function setType(type: string) {
  if (type !== 'category' && type !== 'interval') {
    return;
  }
  const field =
    type === 'category' ||
    props.fields?.some(
      (candidate) => candidate.name === draft.value.field && candidate.type === 'number'
    )
      ? draft.value.field
      : undefined;
  draft.value = { type, field };
  validation.value = '';
  refreshValues();
}
const ruleColors = [
  '#2563eb',
  '#16a34a',
  '#ca8a04',
  '#9333ea',
  '#dc2626',
  '#0891b2',
  '#ea580c',
  '#4f46e5',
  '#db2777',
  '#0f766e',
  '#65a30d',
  '#64748b',
];
function generate() {
  validation.value = '';
  refreshValues();
  if (validation.value) {
    return;
  }
  if (draft.value.type === 'interval') {
    const values = candidates.value
      .filter((value) => typeof value === 'number')
      .sort((leftValue, rightValue) => leftValue - rightValue);
    const min = values[0],
      max = values.at(-1);
    if (min === undefined || max === undefined) {
      validation.value = text('generationEmpty');
      return;
    }
    const size = Math.min(5, values.length);
    const padding = Math.max(1, Math.abs(min) * Number.EPSILON);
    const boundaries =
      min === max
        ? [min - padding, max + padding].map((value) => (Number.isFinite(value) ? value : min))
        : [
            ...new Set(
              Array.from(
                { length: size + 1 },
                (_unused, index) => min * (1 - index / size) + max * (index / size)
              )
            ),
          ].sort((leftValue, rightValue) => leftValue - rightValue);
    draft.value = {
      ...draft.value,
      ranges: boundaries.slice(0, -1).map((lower, index) => ({
        id: `${uid}-${++sequence}`,
        min: lower,
        max: boundaries[index + 1]!,
        color: ruleColors[index]!,
        includeMax: index === boundaries.length - 2,
      })),
    };
  } else {
    if (!candidates.value.length) {
      validation.value = text('generationEmpty');
      return;
    }
    if (candidates.value.length > ruleColors.length) {
      validation.value = text('generationLimit');
      return;
    }
    draft.value = {
      ...draft.value,
      useLayerStyle: false,
      items: candidates.value.map((value, index) => ({
        id: `${uid}-${++sequence}`,
        label: String(value) || '""',
        values: [value],
        color: ruleColors[index]!,
      })),
    };
  }
}
function add() {
  const id = `${uid}-${++sequence}`;
  if (draft.value.type === 'interval') {
    const min = ranges.value.length ? Math.max(...ranges.value.map((range) => range.max)) : 0;
    draft.value = {
      ...draft.value,
      ranges: [...ranges.value, { id, min, max: min + 100, color: defaultColor.value }],
    };
  } else {
    draft.value = {
      ...draft.value,
      items: [...items.value, { id, values: [], label: '', color: defaultColor.value }],
      useLayerStyle: false,
    };
  }
}
function remove(index: number) {
  draft.value =
    draft.value.type === 'interval'
      ? {
          ...draft.value,
          ranges: ranges.value.filter((_range, rangeIndex) => rangeIndex !== index),
        }
      : {
          ...draft.value,
          items: items.value.filter((_item, itemIndex) => itemIndex !== index),
          useLayerStyle: false,
        };
}
function changeItem(index: number, patch: Partial<LegendItem>) {
  const usesLayerStyle = !draft.value.field && items.value.length === 1 && !!props.layerStyle;
  if (usesLayerStyle && patch.color) {
    defaultColor.value = patch.color;
  }
  draft.value = {
    ...draft.value,
    useLayerStyle: usesLayerStyle,
    items: items.value.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item
    ),
  };
}
function changeRange(index: number, patch: Partial<LegendRange>) {
  draft.value = {
    ...draft.value,
    ranges: ranges.value.map((range, rangeIndex) =>
      rangeIndex === index ? { ...range, ...patch } : range
    ),
  };
}
function validColor(value: string) {
  const node = document.createElement('span');
  node.style.color = value;
  return !!node.style.color;
}
function submit() {
  if (props.saving || props.blocked) {
    return;
  }
  validation.value = '';
  try {
    let legend: LayerLegend = JSON.parse(JSON.stringify(draft.value));
    if (convertingToUniform.value) {
      const symbol = props.symbol === 'line' || props.symbol === 'circle' ? props.symbol : 'fill';
      legend = {
        ...legend,
        useLayerStyle: !!props.layerStyle,
        items: [
          {
            id: items.value[0]?.id ?? `${uid}-uniform`,
            label: props.title ?? draft.value.title ?? text('layerColor'),
            color: defaultColor.value,
            symbol,
          },
        ],
      };
    }
    if (legend.type === 'interval') {
      if (!legend.field) {
        throw new Error();
      }
      legend = {
        ...legend,
        ranges: [...ranges.value].sort((leftRange, rightRange) => leftRange.min - rightRange.min),
      };
    }
    if (
      !validColor(style.value.fillColor) ||
      !validColor(style.value.strokeColor) ||
      items.value.some((item) => item.color && !validColor(item.color)) ||
      ranges.value.some((range) => !validColor(range.color))
    ) {
      throw new Error();
    }
    const normalized = parseGISAppConfig({
      layers: [{ id: 'draft', type: 'geojson', style: style.value, legend }],
    }).layers![0]!.legend!;
    emit('submit', {
      legend: normalized,
      ...(props.layerStyle ? { style: { ...style.value } } : {}),
    });
  } catch {
    validation.value = text('invalid');
  }
}
refreshValues();
</script>

<template>
  <form v-bind="$attrs" class="gis-ui-legend-editor gis-ui-legend-card" @submit.prevent="submit">
    <header class="gis-ui-legend-card-header">
      <h3 :title="title ?? draft.title">{{ title ?? draft.title ?? text('title') }}</h3>
      <div class="gis-ui-legend-card-actions">
        <LegendAction
          icon="save"
          type="submit"
          primary
          :disabled="saving || blocked"
          :label="text('save')"
        />
        <LegendAction
          icon="close"
          :disabled="saving"
          :label="text('cancel')"
          @click="emit('cancel')"
        />
      </div>
    </header>
    <p v-if="error || validation" class="gis-ui-error" role="alert">{{ error || validation }}</p>
    <fieldset :disabled="saving || blocked" class="gis-ui-legend-rule-settings">
      <GisSelect
        v-if="!legend"
        :model-value="draft.type"
        :options="typeOptions"
        :label="text('type')"
        floating
        @update:model-value="setType"
      />
      <div class="gis-ui-legend-metric">
        <GisSelect
          v-if="draft.type === 'category' || draft.type === 'interval'"
          :model-value="draft.field ?? ''"
          :options="fieldOptions"
          :label="text('field')"
          :disabled="saving || blocked"
          :placeholder="text('uniform')"
          floating
          @update:model-value="setField"
        />
        <span v-else class="gis-ui-legend-metric-value">{{ draft.field }}</span>
        <span v-if="!uniform" class="gis-ui-legend-mode">{{ text(draft.type) }}</span>
      </div>
      <div v-if="draft.type === 'interval'" class="gis-ui-legend-rule-list">
        <div v-for="(range, index) in ranges" :key="range.id" class="gis-ui-legend-rule-row">
          <LegendColor
            :model-value="range.color"
            :symbol="symbol"
            :label="`${text('color')} ${index + 1}`"
            @update:model-value="changeRange(index, { color: $event })"
          />
          <div class="gis-ui-legend-boundary">
            <span>[</span
            ><input
              :name="`rangeMin-${index}`"
              type="number"
              step="any"
              required
              :aria-label="`${text('min')} ${index + 1}`"
              :value="range.min"
              @input="
                changeRange(index, { min: Number(($event.target as HTMLInputElement).value) })
              "
            /><span>,</span
            ><input
              :name="`rangeMax-${index}`"
              type="number"
              step="any"
              required
              :aria-label="`${text('max')} ${index + 1}`"
              :value="range.max"
              @input="
                changeRange(index, { max: Number(($event.target as HTMLInputElement).value) })
              "
            /><button
              type="button"
              class="gis-ui-legend-endpoint"
              :aria-label="`${text('inclusive')} ${index + 1}`"
              :aria-pressed="!!range.includeMax"
              :title="text('inclusive')"
              @click="changeRange(index, { includeMax: !range.includeMax })"
            >
              {{ range.includeMax ? ']' : ')' }}
            </button>
          </div>
          <LegendAction
            icon="close"
            :disabled="saving || blocked"
            :label="`${text('remove')} ${index + 1}`"
            @click="remove(index)"
          />
        </div>
      </div>
      <div
        v-else-if="draft.type === 'category' && !convertingToUniform && items.length"
        class="gis-ui-legend-rule-list"
      >
        <div
          v-for="(item, index) in items"
          :key="item.id"
          class="gis-ui-legend-category-row"
          :class="{ 'is-uniform': !draft.field }"
        >
          <LegendColor
            :model-value="item.color ?? defaultColor"
            :symbol="symbol"
            :label="`${text('color')} ${index + 1}`"
            @update:model-value="changeItem(index, { color: $event })"
          />
          <GisMultiSelect
            v-if="draft.field"
            :model-value="item.values ?? []"
            :options="options(index)"
            :label="`${text('value')} ${index + 1}`"
            :disabled="saving || blocked"
            :placeholder="text('value')"
            :search-text="text('search')"
            :clear-text="text('clear')"
            :empty-text="text('empty')"
            :missing-text="text('missing')"
            @open="refreshValues"
            @update:model-value="changeItem(index, { values: $event })"
          />
          <input
            :name="`itemLabel-${index}`"
            :aria-label="`${text('item')} ${index + 1}`"
            :placeholder="text('item')"
            :value="item.label"
            @input="changeItem(index, { label: ($event.target as HTMLInputElement).value })"
          />
          <LegendAction
            icon="close"
            :disabled="saving || blocked"
            :label="`${text('remove')} ${index + 1}`"
            @click="remove(index)"
          />
        </div>
      </div>
      <template v-else-if="draft.type === 'continuous'">
        <div v-for="(stop, index) in draft.stops" :key="index" class="gis-ui-legend-stop-editor">
          <LegendColor
            :model-value="stop.color"
            :label="`${text('color')} ${index + 1}`"
            @update:model-value="
              draft = {
                ...draft,
                stops: draft.stops?.map((value, i) =>
                  i === index ? { ...value, color: $event } : value
                ),
              }
            "
          /><span>{{ stop.label ?? stop.value }}</span>
        </div>
      </template>
      <img
        v-else-if="draft.imageUrl"
        class="gis-ui-legend-image"
        :src="draft.imageUrl"
        :alt="draft.title"
      />
      <div
        v-if="layerStyle && (classified || convertingToUniform || (uniform && !items.length))"
        class="gis-ui-legend-default"
      >
        <LegendColor v-model="defaultColor" :symbol="symbol" :label="colorLabel" /><span>{{
          colorLabel
        }}</span>
      </div>
      <div
        v-if="classified || (layerStyle && draft.type !== 'image')"
        class="gis-ui-legend-editor-footer"
      >
        <button v-if="classified" type="button" class="gis-ui-legend-add" @click="add">
          <SvgIcon name="plus" :size="13" />{{ text('add') }}
        </button>
        <button
          v-if="classified && getFieldValues"
          type="button"
          class="gis-ui-legend-add"
          @click="generate"
        >
          {{ text('generate') }}
        </button>
        <button
          v-if="layerStyle && draft.type !== 'image'"
          type="button"
          class="gis-ui-legend-more"
          aria-haspopup="dialog"
          @click="advanced = true"
        >
          <SvgIcon name="more-horizontal" :size="14" />{{ text('more') }}
        </button>
      </div>
    </fieldset>
  </form>
  <LegendStyleDialog
    v-if="advanced"
    :layer-style="style"
    :symbol="symbol"
    :text="text"
    :blocked="saving || blocked"
    @apply="style = $event"
    @close="advanced = false"
  />
</template>
