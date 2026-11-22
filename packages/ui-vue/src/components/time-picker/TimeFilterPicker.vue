<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  useId,
  watch,
  type CSSProperties,
} from 'vue'
import { ElConfigProvider } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/en-gb'
import SvgIcon from '../SvgIcon.vue'
import GisSwitch from '../GisSwitch.vue'
import TimePickerEndpoint from './TimePickerEndpoint.vue'
import { timePickerMessages } from './messages.js'
import {
  formatTimeSelection,
  resolveShortcut,
  timeShortcuts,
  type TimeShortcut,
} from './time-display.js'
import {
  isTimestamp,
  isTimeZone,
  normalizeTimeSelection,
  startOfPeriod,
  zonedTime,
} from './time-period.js'
import {
  timeGranularities,
  timeSelectionModes,
  type TimeFilterPickerEmits,
  type TimeFilterPickerProps,
  type TimeGranularity,
  type TimePickerDraft,
  type TimeSelection,
  type TimeSelectionMode,
} from './types.js'

dayjs.extend(isoWeek)
const english = { ...en, name: 'en-gb' }
const props = withDefaults(defineProps<TimeFilterPickerProps>(), {
  defaultGranularity: 'day',
  defaultMode: 'single',
  locale: 'zh-CN',
  showGranularitySwitch: true,
  showModeSwitch: true,
  showShortcuts: true,
  confirmable: true,
  clearable: true,
})
const emit = defineEmits<TimeFilterPickerEmits>()
const id = useId()
const trigger = ref<HTMLButtonElement>()
const popup = ref<HTMLDialogElement>()
const startCalendar = ref<HTMLElement>()
const endCalendar = ref<HTMLElement>()
const open = ref(false)
const position = shallowRef<CSSProperties>()
const revision = ref(0)
const attempted = ref(false)
const draft = shallowRef<TimePickerDraft>({ mode: 'single', granularity: 'day', timeZone: 'UTC' })
const nativeDialog =
  typeof HTMLDialogElement !== 'undefined' &&
  typeof HTMLDialogElement.prototype.showModal === 'function'
const labels = computed(() => timePickerMessages[props.locale])
const units = computed(() => props.granularities ?? timeGranularities)
const granularityOptions = computed(() =>
  units.value.map((value) => ({ value, label: labels.value[value] }))
)
const modeOptions = computed(() =>
  timeSelectionModes.map((value) => ({ value, label: labels.value[value] }))
)
const unit = computed(() =>
  draft.value.mode === 'custom-range' ? 'custom' : draft.value.granularity
)
const selection = computed(() => normalizeTimeSelection(draft.value))
const allowed = computed(() => selection.value !== null && withinLimits(selection.value))
const summary = computed(() => {
  if (!props.modelValue) return labels.value.title
  try {
    return formatTimeSelection(props.modelValue, props.locale)
  } catch {
    return labels.value.title
  }
})
const zoneLabel = computed(() => {
  const { timeZone, start } = draft.value
  try {
    return timeZone + ' (UTC' + zonedTime(start ?? Date.now(), timeZone).offset + ')'
  } catch {
    return timeZone
  }
})
const shortcuts = computed(() =>
  (Object.keys(timeShortcuts) as TimeShortcut[]).filter((key) => {
    const [granularity, , range] = timeShortcuts[key]
    return (
      units.value.includes(granularity) &&
      (props.showGranularitySwitch || draft.value.granularity === granularity) &&
      (props.showModeSwitch || draft.value.mode === (range ? 'range' : 'single'))
    )
  })
)
const shortcutPreview = computed(() =>
  Object.fromEntries(
    shortcuts.value.map((key) => {
      const value = resolveShortcut(key, Date.now(), draft.value.timeZone)
      return [key, value !== null && withinLimits(value)]
    })
  )
)

function withinLimits(value: TimeSelection) {
  const { start, endExclusive } = value.range
  return (
    (value.granularity === 'custom' || units.value.includes(value.granularity)) &&
    (props.minTime === undefined || (isTimestamp(props.minTime) && start >= props.minTime)) &&
    (props.maxTime === undefined ||
      (isTimestamp(props.maxTime) && endExclusive <= props.maxTime)) &&
    (props.maxRangeDurationMs === undefined ||
      (Number.isSafeInteger(props.maxRangeDurationMs) &&
        props.maxRangeDurationMs > 0 &&
        endExclusive - start <= props.maxRangeDurationMs))
  )
}

function periodAllowed(time: number) {
  if (
    props.minTime === undefined &&
    props.maxTime === undefined &&
    props.maxRangeDurationMs === undefined
  )
    return true
  const value = normalizeTimeSelection({ ...draft.value, mode: 'single', start: time })
  return value !== null && withinLimits(value)
}

function fromSelection(value: TimeSelection | null | undefined): TimePickerDraft {
  const fallback = units.value.includes(props.defaultGranularity)
    ? props.defaultGranularity
    : (units.value[0] ?? 'day')
  const validMode = value && timeSelectionModes.includes(value.mode)
  const base = {
    mode: validMode ? value.mode : props.defaultMode,
    granularity:
      value && value.granularity !== 'custom' && units.value.includes(value.granularity)
        ? value.granularity
        : fallback,
    timeZone:
      value?.timeZone ??
      props.defaultTimeZone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      'UTC',
  }
  if (
    !value ||
    !isTimeZone(base.timeZone) ||
    !isTimestamp(value.range?.start) ||
    !isTimestamp(value.range?.endExclusive) ||
    value.range.start >= value.range.endExclusive
  )
    return base
  if (base.mode === 'custom-range')
    return { ...base, start: value.range.start, end: value.range.endExclusive }
  try {
    return {
      ...base,
      start: startOfPeriod(value.range.start, base.granularity, base.timeZone),
      end:
        base.mode === 'range'
          ? startOfPeriod(value.range.endExclusive - 1, base.granularity, base.timeZone)
          : undefined,
    }
  } catch {
    return base
  }
}

function place() {
  if (!trigger.value) return
  const anchor = trigger.value.getBoundingClientRect()
  const width = Math.min(410, window.innerWidth - 24)
  const below = window.innerHeight - anchor.bottom - 20
  const above = anchor.top - 20
  const center = Math.max(above, below) < 325
  const upward = !center && below < 380 && above > below
  position.value = {
    width: width + 'px',
    left: Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12)) + 'px',
    top: upward ? 'auto' : (center ? 12 : anchor.bottom + 8) + 'px',
    bottom: upward ? window.innerHeight - anchor.top + 8 + 'px' : 'auto',
    maxHeight: (center ? window.innerHeight - 24 : upward ? above : below) + 'px',
  }
}

function stopPositioning() {
  window.removeEventListener('resize', place)
  window.removeEventListener('scroll', place, true)
}

function show() {
  const dialog = popup.value
  if (props.disabled || !dialog || (nativeDialog ? dialog.open : open.value)) return
  draft.value = fromSelection(props.modelValue)
  attempted.value = false
  revision.value++
  place()
  if (nativeDialog) dialog.showModal()
  open.value = true
  window.addEventListener('resize', place)
  window.addEventListener('scroll', place, true)
  void nextTick(() => {
    if (open.value) popup.value?.querySelector<HTMLElement>('header strong')?.focus()
  })
}

function close() {
  if (nativeDialog && popup.value?.open) popup.value.close()
  syncClosed()
}

function syncClosed() {
  // A queued native close event can arrive after the dialog has already reopened.
  if (!open.value || (nativeDialog && popup.value?.open)) return
  open.value = false
  stopPositioning()
  trigger.value?.focus()
}

function cancel() {
  close()
  emit('cancel')
}

function sameValue(left: TimeSelection, right: TimeSelection | null | undefined) {
  return (
    right?.mode === left.mode &&
    right.granularity === left.granularity &&
    right.timeZone === left.timeZone &&
    right.range?.start === left.range.start &&
    right.range.endExclusive === left.range.endExclusive
  )
}

function apply() {
  attempted.value = true
  const value = selection.value
  if (!value || !allowed.value) return
  close()
  if (sameValue(value, props.modelValue)) return
  emit('update:modelValue', value)
  emit('change', value)
  emit('apply', value)
}

function clear() {
  close()
  if (props.modelValue != null) {
    emit('update:modelValue', null)
    emit('change', null)
  }
  emit('clear')
}

function updateEndpoint(name: 'start' | 'end', value: number | undefined) {
  draft.value = { ...draft.value, [name]: value }
  attempted.value = value !== undefined
  if (!props.confirmable && allowed.value) apply()
}

function changeMode(mode: TimeSelectionMode, granularity: TimeGranularity) {
  const old = selection.value
  const start = old?.range.start ?? draft.value.start
  const end =
    mode === 'single' || !old ? undefined : old.range.endExclusive - (mode === 'range' ? 1 : 0)
  const next = { ...draft.value, mode, granularity, start, end }
  const aligned = normalizeTimeSelection(next)
  draft.value = aligned ? { ...fromSelection(aligned), granularity } : next
  attempted.value = Boolean(aligned)
  revision.value++
  if (!props.confirmable && allowed.value) apply()
}

function shortcut(key: TimeShortcut) {
  const value = resolveShortcut(key, Date.now(), draft.value.timeZone)
  if (!value || !withinLimits(value)) return
  draft.value = fromSelection(value)
  attempted.value = false
  revision.value++
  if (!props.confirmable) apply()
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
)
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) close()
  }
)
onBeforeUnmount(stopPositioning)
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
          :model-value="draft.mode"
          :group-label="labels.mode"
          :options="modeOptions"
          @update:model-value="changeMode($event as TimeSelectionMode, draft.granularity)"
        />
        <GisSwitch
          v-if="showGranularitySwitch && unit !== 'custom' && units.length > 1"
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
            :key="name + '-' + revision"
            :model-value="draft[name]"
            :unit="unit"
            :time-zone="draft.timeZone"
            :label="draft.mode === 'single' ? labels[unit as TimeGranularity] : labels[name]"
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
