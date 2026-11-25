import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import TimePicker from '../src/components/time-picker/TimeFilterPicker.vue';
import {
  formatTimeSelection,
  resolveShortcut,
} from '../src/components/time-picker/time-display.js';
import {
  addPeriod,
  normalizeTimeSelection,
  startOfPeriod,
  wallTimeCandidates,
} from '../src/components/time-picker/time-period.js';
import type { TimeGranularity, TimeSelection } from '../src/components/time-picker/types.js';

const zone = 'Asia/Shanghai';
const sample = Date.parse('2026-11-21T10:25:00+08:00');
const shanghai = (date: string) => Date.parse(date + '+08:00');
const dateStub = defineComponent({
  name: 'ElDatePicker',
  props: { modelValue: String, ariaLabel: String },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () =>
      h('input', {
        value: props.modelValue,
        'aria-label': props.ariaLabel,
        onInput: (event: Event) =>
          emit('update:modelValue', (event.target as HTMLInputElement).value),
      });
  },
});
const global = { stubs: { ElDatePicker: dateStub } };

describe('time periods', () => {
  const cases: [TimeGranularity, string, string][] = [
    ['hour', '2026-11-21T10:00:00', '2026-11-21T11:00:00'],
    ['day', '2026-11-21T00:00:00', '2026-11-22T00:00:00'],
    ['week', '2026-11-16T00:00:00', '2026-11-23T00:00:00'],
    ['month', '2026-11-01T00:00:00', '2026-12-01T00:00:00'],
    ['year', '2026-01-01T00:00:00', '2027-01-01T00:00:00'],
  ];
  it.each(cases)(
    'normalizes a single %s and includes the last selected period of a range',
    (granularity, first, next) => {
      const start = shanghai(first),
        endExclusive = shanghai(next);
      expect(startOfPeriod(sample, granularity, zone)).toBe(start);
      expect(addPeriod(start, granularity, 1, zone)).toBe(endExclusive);
      expect(
        normalizeTimeSelection({ mode: 'single', granularity, timeZone: zone, start: sample })
          ?.range
      ).toEqual({ start, endExclusive });
      expect(
        normalizeTimeSelection({
          mode: 'range',
          granularity,
          timeZone: zone,
          start: sample,
          end: endExclusive,
        })?.range
      ).toEqual({ start, endExclusive: addPeriod(endExclusive, granularity, 1, zone) });
    }
  );
  it('handles Unix zero, a leap month, ISO week-year, invalid input and exact ranges', () => {
    expect(
      normalizeTimeSelection({ mode: 'single', granularity: 'day', timeZone: 'UTC', start: 0 })
        ?.range
    ).toEqual({ start: 0, endExclusive: 86400000 });
    expect(addPeriod(Date.UTC(2024, 1, 1), 'month', 1, 'UTC')).toBe(Date.UTC(2024, 2, 1));
    const week = normalizeTimeSelection({
      mode: 'single',
      granularity: 'week',
      timeZone: 'UTC',
      start: Date.UTC(2027, 0, 1),
    })!;
    expect(week.range).toEqual({
      start: Date.UTC(2026, 11, 28),
      endExclusive: Date.UTC(2027, 0, 4),
    });
    expect(formatTimeSelection(week, 'en')).toBe('2026-W53');
    expect(formatTimeSelection(week)).toBe('2026年第53周');
    const exact = {
      mode: 'custom-range',
      granularity: 'custom',
      timeZone: 'UTC',
      start: 0,
      end: 1001,
    } as const;
    expect(normalizeTimeSelection(exact)?.range).toEqual({ start: 0, endExclusive: 1001 });
    expect(normalizeTimeSelection({ ...exact, end: 0 })).toBeNull();
    expect(normalizeTimeSelection({ ...exact, end: undefined })).toBeNull();
    expect(normalizeTimeSelection({ ...exact, timeZone: 'Invalid/Zone' })).toBeNull();
    expect(normalizeTimeSelection({ ...exact, start: NaN })).toBeNull();
    expect(normalizeTimeSelection({ ...exact, mode: 'range' })).toBeNull();
  });
  it('covers 23 and 25 hour days and separates repeated local hours by UTC offset', () => {
    const ny = 'America/New_York';
    const spring = normalizeTimeSelection({
      mode: 'single',
      granularity: 'day',
      timeZone: ny,
      start: Date.parse('2024-03-10T15:00Z'),
    })!;
    expect(spring.range.endExclusive - spring.range.start).toBe(23 * 3600000);
    const fall = normalizeTimeSelection({
      mode: 'single',
      granularity: 'day',
      timeZone: ny,
      start: Date.parse('2024-11-03T15:00Z'),
    })!;
    expect(fall.range.endExclusive - fall.range.start).toBe(25 * 3600000);
    expect(wallTimeCandidates('2024-03-10', '02:00', ny)).toHaveLength(0);
    const times = wallTimeCandidates('2024-11-03', '01:00', ny);
    expect(times.map((time) => time.offset)).toEqual(['-04:00', '-05:00']);
    expect(times.map((time) => startOfPeriod(time.epochMilliseconds + 1000, 'hour', ny))).toEqual(
      times.map((time) => time.epochMilliseconds)
    );
    expect(addPeriod(times[0]!.epochMilliseconds, 'hour', 1, ny)).toBe(times[1]!.epochMilliseconds);
    expect(
      resolveShortcut('last-7-days', Date.parse('2024-03-10T15:00Z'), ny)?.range.endExclusive
    ).toBe(spring.range.endExclusive);
  });
});

describe('standalone picker', () => {
  it('isolates shortcuts and manual selection until confirm, cancels, synchronizes props and clears', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(sample);
    const picker = mount(TimePicker, { props: { defaultTimeZone: zone }, global });
    const trigger = picker.get('.gis-ui-time-picker-trigger');
    const button = (label: string) =>
      picker.findAll('button').find((button) => button.text() === label)!;
    try {
      await trigger.trigger('click');
      await button('本周').trigger('click');
      expect(picker.emitted('update:modelValue')).toBeUndefined();
      await button('取消').trigger('click');
      expect(picker.emitted('cancel')).toHaveLength(1);
      await trigger.trigger('click');
      await button('本周').trigger('click');
      await picker.get('form').trigger('submit');
      const selected = (picker.emitted('apply')![0] as [TimeSelection])[0];
      expect(selected.granularity).toBe('week');
      await picker.setProps({ modelValue: selected });
      expect(trigger.text()).toContain('2026年第47周');
      await trigger.trigger('click');
      await picker.setProps({ modelValue: { ...selected, range: { ...selected.range } } });
      expect(picker.find('form').exists()).toBe(true);
      await picker.get('form').trigger('submit');
      expect(picker.emitted('apply')).toHaveLength(1);
      await trigger.trigger('click');
      await button('昨天').trigger('click');
      const other = resolveShortcut('today', sample, zone)!;
      await picker.setProps({ modelValue: other });
      expect(picker.find('form').exists()).toBe(false);
      expect(trigger.text()).toContain('2026-11-21');
      await trigger.trigger('click');
      await button('清空').trigger('click');
      expect(picker.emitted('update:modelValue')?.at(-1)).toEqual([null]);
      expect(picker.emitted('clear')).toHaveLength(1);
    } finally {
      picker.unmount();
    }
  });

  it('reopens after a native dialog close before its close event is delivered', async () => {
    const dialog = HTMLDialogElement.prototype;
    const originalShow = Object.getOwnPropertyDescriptor(dialog, 'showModal');
    const originalClose = Object.getOwnPropertyDescriptor(dialog, 'close');
    Object.defineProperties(dialog, {
      showModal: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.open = true;
        },
      },
      close: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.open = false;
        },
      },
    });
    try {
      const selected = resolveShortcut('today', sample, zone)!;
      const picker = mount(TimePicker, { props: { modelValue: selected }, global });
      try {
        const trigger = picker.get('.gis-ui-time-picker-trigger');
        const popup = picker.get<HTMLDialogElement>('dialog');
        await trigger.trigger('click');
        expect(popup.element.open).toBe(true);
        popup.element.close();
        await trigger.trigger('click');
        expect(popup.element.open).toBe(true);
        await popup.trigger('close');
        expect(trigger.attributes('aria-expanded')).toBe('true');
        expect(picker.find('form').exists()).toBe(true);
        popup.element.close();
        await popup.trigger('close');
        expect(trigger.attributes('aria-expanded')).toBe('false');
      } finally {
        picker.unmount();
      }
    } finally {
      if (originalShow) Object.defineProperty(dialog, 'showModal', originalShow);
      else Reflect.deleteProperty(dialog, 'showModal');
      if (originalClose) Object.defineProperty(dialog, 'close', originalClose);
      else Reflect.deleteProperty(dialog, 'close');
    }
  });

  it('accepts hours across dates in immediate mode and rejects a range cut by a limit', async () => {
    const picker = mount(TimePicker, {
      props: {
        defaultMode: 'range',
        defaultGranularity: 'hour',
        defaultTimeZone: zone,
        confirmable: false,
        maxTime: shanghai('2026-11-22T04:00:00'),
      },
      global,
    });
    try {
      await picker.get('.gis-ui-time-picker-trigger').trigger('click');
      const inputs = picker.findAll('.gis-ui-time-picker-endpoint input');
      await inputs[0]!.setValue('2026-11-21');
      await inputs[1]!.setValue('2026-11-22');
      const hours = picker.findAll('.gis-ui-time-picker-endpoint [role="combobox"]');
      await hours[0]!.trigger('click');
      await picker.get('[role="option"][title="22:00"]').trigger('click');
      expect(picker.emitted('apply')).toBeUndefined();
      await hours[1]!.trigger('click');
      const disabled = picker.get('[role="option"][title="04:00"]');
      expect(disabled.attributes('aria-disabled')).toBe('true');
      await disabled.trigger('click');
      expect(picker.emitted('apply')).toBeUndefined();
      await hours[1]!.trigger('keydown', { key: 'End' });
      expect(hours[1]!.attributes('aria-activedescendant')).toBe(
        picker.get('[role="option"][title="03:00"]').attributes('id')
      );
      await hours[1]!.trigger('keydown', { key: 'Enter' });
      expect(picker.emitted('apply')?.[0]?.[0]).toMatchObject({
        granularity: 'hour',
        mode: 'range',
        range: {
          start: shanghai('2026-11-21T22:00:00'),
          endExclusive: shanghai('2026-11-22T04:00:00'),
        },
      });
    } finally {
      picker.unmount();
    }
  });

  it('expands an exact range to the intersecting natural days when changing mode', async () => {
    const value = normalizeTimeSelection({
      mode: 'custom-range',
      granularity: 'custom',
      timeZone: zone,
      start: shanghai('2026-11-20T10:00:00'),
      end: shanghai('2026-11-21T15:00:00'),
    })!;
    const picker = mount(TimePicker, {
      props: { modelValue: value, showShortcuts: false },
      global,
    });
    try {
      await picker.get('.gis-ui-time-picker-trigger').trigger('click');
      await picker.get('button[aria-label="周期范围"]').trigger('click');
      await picker.get('form').trigger('submit');
      expect(picker.emitted('apply')?.[0]?.[0]).toEqual({
        mode: 'range',
        granularity: 'day',
        timeZone: zone,
        range: {
          start: shanghai('2026-11-20T00:00:00'),
          endExclusive: shanghai('2026-11-22T00:00:00'),
        },
      });
    } finally {
      picker.unmount();
    }
  });

  it('reopens a submitted exact range and gives each calendar its own popper target', async () => {
    const picker = mount(TimePicker, { attachTo: document.body, props: { defaultTimeZone: zone } });
    try {
      const trigger = picker.get('.gis-ui-time-picker-trigger');
      await trigger.trigger('click');
      await picker.get('button[aria-label="精确范围"]').trigger('click');
      const calendars = picker.findAllComponents({ name: 'ElDatePicker' });
      expect(calendars).toHaveLength(2);
      const dateInputs = picker.findAll('.gis-ui-time-picker-fields input.el-input__inner');
      const hosts = picker.findAll('.gis-ui-time-picker-calendar-host');
      await dateInputs[0]!.trigger('mousedown');
      expect(hosts[0]!.find('.el-picker__popper').exists()).toBe(true);
      calendars[0]!.vm.$emit('update:modelValue', '2026-11-21');
      await picker.findAll('input[type="time"]')[0]!.setValue('10:20:00');
      await dateInputs[1]!.trigger('mousedown');
      expect(hosts[1]!.find('.el-picker__popper').exists()).toBe(true);
      calendars[1]!.vm.$emit('update:modelValue', '2026-11-22');
      await picker.findAll('input[type="time"]')[1]!.setValue('15:45:00');
      await picker.get('form').trigger('submit');
      const selection = (picker.emitted('apply')![0] as [TimeSelection])[0];
      expect(selection.range).toEqual({
        start: shanghai('2026-11-21T10:20:00'),
        endExclusive: shanghai('2026-11-22T15:45:00'),
      });
      await picker.setProps({ modelValue: selection });
      await trigger.trigger('click');
      expect(
        picker
          .findAll<HTMLInputElement>('.gis-ui-time-picker-fields input')
          .map((input) => input.element.value)
      ).toEqual(['2026-11-21', '10:20:00', '2026-11-22', '15:45:00']);
      await picker
        .findAll('.gis-ui-time-picker-fields input.el-input__inner')[1]!
        .trigger('mousedown');
      expect(hosts[1]!.find('.el-picker__popper').exists()).toBe(true);
    } finally {
      picker.unmount();
    }
  });
});
