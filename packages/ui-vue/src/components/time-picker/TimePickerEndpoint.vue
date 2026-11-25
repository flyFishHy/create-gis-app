<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElDatePicker } from 'element-plus';
import 'element-plus/theme-chalk/base.css';
import 'element-plus/theme-chalk/el-button.css';
import 'element-plus/theme-chalk/el-input.css';
import 'element-plus/theme-chalk/el-scrollbar.css';
import 'element-plus/theme-chalk/el-popper.css';
import 'element-plus/theme-chalk/el-date-picker-panel.css';
import 'element-plus/theme-chalk/el-date-picker.css';
import GisSelect from '../GisSelect.vue';
import { calendarDate, startOfPeriod, wallTimeCandidates, zonedTime } from './time-period.js';
import type { TimeGranularity } from './types.js';

const props = defineProps<{
  modelValue?: number;
  unit: TimeGranularity | 'custom';
  timeZone: string;
  label: string;
  hourLabel: string;
  clockLabel: string;
  offsetLabel: string;
  gapLabel: string;
  periodAllowed: (time: number) => boolean;
  calendarHost?: HTMLElement;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: number | undefined] }>();
const date = ref('');
const clock = ref('');
const instant = ref('');
const pickerType = computed(() =>
  props.unit === 'year' || props.unit === 'month' || props.unit === 'week' ? props.unit : 'date'
);
const format = computed(() =>
  props.unit === 'year'
    ? 'YYYY'
    : props.unit === 'month'
      ? 'YYYY-MM'
      : props.unit === 'week'
        ? 'GGGG-[W]WW'
        : 'YYYY-MM-DD'
);
const hours = computed(() => {
  if (props.unit !== 'hour' || !date.value) {
    return [];
  }
  return Array.from({ length: 24 }, (_unused, hour) => {
    const label = String(hour).padStart(2, '0') + ':00';
    const options = wallTimeCandidates(date.value, label, props.timeZone);
    return options.map((value) => ({
      value: String(value.epochMilliseconds),
      label: options.length > 1 ? label + ' (UTC' + value.offset + ')' : label,
      hour,
      offset: value.offset,
    }));
  }).flat();
});
const exact = computed(() =>
  props.unit === 'custom' && date.value && clock.value
    ? wallTimeCandidates(date.value, clock.value, props.timeZone)
    : []
);
const hourOptions = computed(() =>
  hours.value.map((hour) => ({
    value: hour.value,
    label: hour.label,
    disabled: !props.periodAllowed(Number(hour.value)),
  }))
);
const offsetOptions = computed(() =>
  exact.value.map((option) => ({
    value: String(option.epochMilliseconds),
    label: `UTC${option.offset}`,
  }))
);
const decoded = computed(() => {
  if (!date.value) {
    return undefined;
  }
  if (props.unit === 'hour') {
    return instant.value && hours.value.some((hour) => hour.value === instant.value)
      ? Number(instant.value)
      : undefined;
  }
  if (props.unit === 'custom') {
    const candidate = exact.value.find(
      (value) => String(value.epochMilliseconds) === instant.value
    );
    return (candidate ?? (exact.value.length === 1 ? exact.value[0] : undefined))
      ?.epochMilliseconds;
  }
  const value = calendarDate(date.value, props.timeZone);
  if (value === undefined) {
    return undefined;
  }
  try {
    return startOfPeriod(value, props.unit, props.timeZone);
  } catch {
    return undefined;
  }
});

watch(
  () => props.modelValue,
  (value) => {
    if (value === decoded.value) {
      return;
    }
    if (value === undefined) {
      date.value = '';
      clock.value = '';
      instant.value = '';
      return;
    }
    try {
      const zoned = zonedTime(value, props.timeZone);
      date.value = zoned.toPlainDate().toString();
      clock.value = zoned
        .toPlainTime()
        .toString({ smallestUnit: zoned.millisecond ? 'millisecond' : 'second' });
      instant.value = String(value);
    } catch {
      date.value = '';
      clock.value = '';
      instant.value = '';
    }
  },
  { immediate: true }
);

function chooseDate(value: unknown) {
  const previousHour = hours.value.find((option) => option.value === instant.value);
  date.value = typeof value === 'string' ? value : '';
  instant.value = '';
  if (previousHour) {
    const candidates = hours.value.filter((option) => option.hour === previousHour.hour);
    const selected =
      candidates.length === 1
        ? candidates[0]
        : candidates.find((option) => option.offset === previousHour.offset);
    instant.value = selected?.value ?? '';
  }
  emit('update:modelValue', decoded.value);
}

function chooseClock(event: Event) {
  clock.value = (event.target as HTMLInputElement).value;
  instant.value = '';
  emit('update:modelValue', decoded.value);
}

function chooseInstant(value: string) {
  instant.value = value;
  emit('update:modelValue', decoded.value);
}

function disabledDate(value: Date) {
  const day = [
    String(value.getFullYear()).padStart(4, '0'),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
  const timestamp = calendarDate(day, props.timeZone);
  return (
    timestamp === undefined ||
    (props.unit !== 'hour' && props.unit !== 'custom' && !props.periodAllowed(timestamp))
  );
}
</script>

<template>
  <fieldset class="gis-ui-time-picker-endpoint">
    <legend>{{ label }}</legend>
    <div class="gis-ui-time-picker-fields">
      <ElDatePicker
        :model-value="date"
        :type="pickerType"
        value-format="YYYY-MM-DD"
        :format="format"
        :ariaLabel="label"
        :placeholder="label"
        :clearable="false"
        :editable="false"
        v-bind="{ appendTo: calendarHost }"
        :show-week-number="unit === 'week'"
        :automatic-dropdown="false"
        :popper-options="{ strategy: 'fixed' }"
        :disabled-date="disabledDate"
        @update:model-value="chooseDate"
      />
      <GisSelect
        v-if="unit === 'hour'"
        :label="hourLabel"
        :placeholder="hourLabel"
        :model-value="instant"
        :options="hourOptions"
        :floating="!!calendarHost"
        :append-to="calendarHost"
        @update:model-value="chooseInstant"
      />
      <input
        v-if="unit === 'custom'"
        type="time"
        :aria-label="clockLabel"
        :value="clock"
        step="0.001"
        @input="chooseClock"
      />
      <GisSelect
        v-if="exact.length > 1"
        :label="offsetLabel"
        :placeholder="offsetLabel"
        :model-value="instant"
        :options="offsetOptions"
        :floating="!!calendarHost"
        :append-to="calendarHost"
        @update:model-value="chooseInstant"
      />
    </div>
    <p
      v-if="
        (date && clock && unit === 'custom' && !exact.length) ||
        (date && unit === 'hour' && !hours.length)
      "
      role="status"
    >
      {{ gapLabel }}
    </p>
  </fieldset>
</template>
