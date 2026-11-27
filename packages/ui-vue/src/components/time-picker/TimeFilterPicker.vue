<script setup lang="ts">
import { computed, ref, shallowRef, useId, watch } from 'vue';
import { ElConfigProvider } from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import en from 'element-plus/es/locale/lang/en';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import 'dayjs/locale/zh-cn';
import 'dayjs/locale/en-gb';
import SvgIcon from '../SvgIcon.vue';
import GisSwitch from '../GisSwitch.vue';
import TimePickerEndpoint from './TimePickerEndpoint.vue';
import { timePickerMessages } from './messages.js';
import {
  formatTimeSelection,
  resolveShortcut,
  timeShortcuts,
  type TimeShortcut,
} from './time-display.js';
import { isTimestamp, isTimeZone, normalizeTimeSelection, zonedTime } from './time-period.js';
import {
  timeGranularities,
  timeSelectionModes,
  type TimeFilterPickerEmits,
  type TimeFilterPickerProps,
  type TimeGranularity,
  type TimeSelection,
  type TimeSelectionMode,
} from './types.js';
import {
  fromDraft,
  sameTimeSelection,
  switchDraft,
  toDraft,
  type TimeDraft,
} from './time-draft.js';
import { useTimePickerDialog } from './use-time-picker-dialog.js';

dayjs.extend(isoWeek);
const english = { ...en, name: 'en-gb' };
const props = withDefaults(defineProps<TimeFilterPickerProps>(), {
  defaultGranularity: 'day',
  defaultMode: 'single',
  locale: 'zh-CN',
  showGranularitySwitch: true,
  showModeSwitch: true,
  showShortcuts: true,
  confirmable: true,
  clearable: true,
});
const emit = defineEmits<TimeFilterPickerEmits>();
const id = useId();
const {
  trigger,
  popup,
  open,
  position,
  nativeDialog,
  show: showDialog,
  close,
  syncClosed,
} = useTimePickerDialog();
const startCalendar = ref<HTMLElement>();
const endCalendar = ref<HTMLElement>();
const endpointKey = ref(0);
const attempted = ref(false);
const draft = shallowRef<TimeDraft>({ mode: 'single', granularity: 'day', timeZone: 'UTC' });
const periodUnit = ref<TimeGranularity>('day');
const labels = computed(() => timePickerMessages[props.locale]);
const units = computed(() => props.granularities ?? timeGranularities);
const granularityOptions = computed(() =>
  units.value.map((value) => ({ value, label: labels.value[value] }))
);
const modeOptions = computed(() =>
  timeSelectionModes.map((value) => ({ value, label: labels.value[value] }))
);
const displayMode = computed(() =>
  draft.value.granularity === 'datetime' ? 'custom-range' : draft.value.mode
);
const selection = computed(() => fromDraft(draft.value));
const allowed = computed(() => selection.value !== null && withinLimits(selection.value));
const summary = computed(() => {
  if (!props.modelValue) {
    return labels.value.title;
  }
  try {
    return formatTimeSelection(props.modelValue, props.locale);
  } catch {
    return labels.value.title;
  }
});
const zoneLabel = computed(() => {
  const { timeZone, start } = draft.value;
  try {
    return timeZone + ' (UTC' + zonedTime(start ?? Date.now(), timeZone).offset + ')';
  } catch {
    return timeZone;
  }
});
const shortcuts = computed(() =>
  (Object.keys(timeShortcuts) as TimeShortcut[]).filter((key) => {
    const [granularity, , range] = timeShortcuts[key];
    return (
      units.value.includes(granularity) &&
      (props.showGranularitySwitch || periodUnit.value === granularity) &&
      (props.showModeSwitch || displayMode.value === (range ? 'range' : 'single'))
    );
  })
);
const shortcutPreview = computed(() =>
  Object.fromEntries(
    shortcuts.value.map((key) => {
      const value = resolveShortcut(key, Date.now(), draft.value.timeZone);
      return [key, value !== null && withinLimits(value)];
    })
  )
);

function withinLimits(value: TimeSelection) {
  const { start, endExclusive } = value.range;
  return (
    (value.granularity === 'custom' || units.value.includes(value.granularity)) &&
    (props.minTime === undefined || (isTimestamp(props.minTime) && start >= props.minTime)) &&
    (props.maxTime === undefined ||
      (isTimestamp(props.maxTime) && endExclusive <= props.maxTime)) &&
    (props.maxRangeDurationMs === undefined ||
      (Number.isSafeInteger(props.maxRangeDurationMs) &&
        props.maxRangeDurationMs > 0 &&
        endExclusive - start <= props.maxRangeDurationMs))
  );
}

function periodAllowed(time: number) {
  if (
    props.minTime === undefined &&
    props.maxTime === undefined &&
    props.maxRangeDurationMs === undefined
  ) {
    return true;
  }
  if (draft.value.granularity === 'datetime') {
    return true;
  }
  const value = normalizeTimeSelection({ ...draft.value, mode: 'single', start: time });
  return value !== null && withinLimits(value);
}

function loadDraft(value: TimeSelection | null | undefined) {
  const fallback = units.value.includes(props.defaultGranularity)
    ? props.defaultGranularity
    : (units.value[0] ?? 'day');
  const mode = value && timeSelectionModes.includes(value.mode) ? value.mode : props.defaultMode;
  const granularity =
    value && value.granularity !== 'custom' && units.value.includes(value.granularity)
      ? value.granularity
      : fallback;
  const timeZone =
    value?.timeZone ??
    props.defaultTimeZone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    'UTC';
  periodUnit.value = granularity;
  draft.value = toDraft(value, mode, granularity, timeZone);
}

function show() {
  if (props.disabled || !showDialog()) {
    return;
  }
  loadDraft(props.modelValue);
  attempted.value = false;
  endpointKey.value++;
}

function cancel() {
  close();
  emit('cancel');
}

function apply() {
  attempted.value = true;
  const value = selection.value;
  if (!value || !allowed.value) {
    return;
  }
  close();
  if (sameTimeSelection(value, props.modelValue)) {
    return;
  }
  emit('update:modelValue', value);
  emit('change', value);
  emit('apply', value);
}

function clear() {
  close();
  if (props.modelValue != null) {
    emit('update:modelValue', null);
    emit('change', null);
  }
  emit('clear');
}

function updateEndpoint(name: 'start' | 'end', value: number | undefined) {
  draft.value = { ...draft.value, [name]: value };
  attempted.value = value !== undefined;
  if (!props.confirmable && allowed.value) {
    apply();
  }
}

function changeMode(mode: TimeSelectionMode, granularity: TimeGranularity) {
  periodUnit.value = granularity;
  draft.value = switchDraft(draft.value, mode, granularity);
  attempted.value = selection.value !== null;
  endpointKey.value++;
  if (!props.confirmable && allowed.value) {
    apply();
  }
}

function shortcut(key: TimeShortcut) {
  const value = resolveShortcut(key, Date.now(), draft.value.timeZone);
  if (!value || !withinLimits(value)) {
    return;
  }
  loadDraft(value);
  attempted.value = false;
  endpointKey.value++;
  if (!props.confirmable) {
    apply();
  }
}

watch(
  [
    () => props.modelValue?.mode,
    () => props.modelValue?.granularity,
    () => props.modelValue?.timeZone,
    () => props.modelValue?.range?.start,
    () => props.modelValue?.range?.endExclusive,
  ],
  close,
  { flush: 'sync' }
);
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) {
      close();
    }
  }
);
</script>

<template>
  <div class="gis-ui-time-picker">
    <button
      ref="trigger"
      type="button"
      class="gis-ui-time-picker-trigger"
      :title="summary"
      :disabled="disabled"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="id"
      @click="show"
    >
      <SvgIcon name="calendar" :size="16" />
      <span>{{ summary }}</span>
      <SvgIcon name="chevron-down" :size="12" />
    </button>
    <dialog
      :id="id"
      ref="popup"
      class="gis-ui-time-picker-popup"
      :open="(!nativeDialog && open) || undefined"
      :style="position"
      :aria-labelledby="id + '-title'"
      @close="syncClosed"
      @cancel.prevent="cancel"
      @click.self="cancel"
      @keydown.esc.stop="!nativeDialog && cancel()"
      @keydown.stop
    >
      <div ref="startCalendar" class="gis-ui-time-picker-calendar-host"></div>
      <div ref="endCalendar" class="gis-ui-time-picker-calendar-host"></div>
      <form v-if="open" class="gis-ui-time-picker-form" @submit.prevent="apply">
        <header>
          <strong :id="id + '-title'" tabindex="-1">{{ labels.title }}</strong>
          <span :title="labels.zone">{{ zoneLabel }}</span>
        </header>
        <GisSwitch
          v-if="showModeSwitch"
          :model-value="displayMode"
          :group-label="labels.mode"
          :options="modeOptions"
          @update:model-value="changeMode($event as TimeSelectionMode, periodUnit)"
        />
        <GisSwitch
          v-if="showGranularitySwitch && draft.granularity !== 'datetime' && units.length > 1"
          :model-value="draft.granularity"
          :group-label="labels.granularity"
          :options="granularityOptions"
          @update:model-value="changeMode(draft.mode, $event as TimeGranularity)"
        />
        <ElConfigProvider :locale="locale === 'zh-CN' ? zhCn : english">
          <TimePickerEndpoint
            v-for="name in draft.mode === 'single'
              ? (['start'] as const)
              : (['start', 'end'] as const)"
            :key="name + '-' + endpointKey"
            :model-value="draft[name]"
            :unit="draft.granularity"
            :time-zone="draft.timeZone"
            :label="draft.mode === 'single' ? labels[draft.granularity] : labels[name]"
            :hour-label="labels.hour"
            :clock-label="labels.clock"
            :offset-label="labels.offset"
            :gap-label="labels.gap"
            :period-allowed="periodAllowed"
            :calendar-host="name === 'start' ? startCalendar : endCalendar"
            @update:model-value="updateEndpoint(name, $event)"
          />
        </ElConfigProvider>
        <div
          v-if="showShortcuts && shortcuts.length"
          class="gis-ui-time-picker-shortcuts"
          role="group"
          :aria-label="labels.shortcuts"
        >
          <button
            v-for="key in shortcuts"
            :key="key"
            type="button"
            :disabled="!shortcutPreview[key]"
            @click="shortcut(key)"
          >
            {{ labels[key] }}
          </button>
        </div>
        <p
          v-if="
            !isTimeZone(draft.timeZone) ||
            (attempted &&
              !selection &&
              draft.start !== undefined &&
              (draft.mode === 'single' || draft.end !== undefined)) ||
            (selection && !allowed)
          "
          class="gis-ui-error"
          role="alert"
        >
          {{ selection ? labels.limits : labels.invalid }}
        </p>
        <footer>
          <button v-if="clearable" type="button" class="gis-ui-time-picker-clear" @click="clear">
            {{ labels.clear }}
          </button>
          <button type="button" @click="cancel">{{ labels.cancel }}</button>
          <button
            v-if="confirmable"
            type="submit"
            class="gis-ui-time-picker-apply"
            :disabled="!allowed"
          >
            {{ labels.apply }}
          </button>
        </footer>
      </form>
    </dialog>
  </div>
</template>
