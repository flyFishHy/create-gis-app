import {
  addPeriod,
  normalizeTimeSelection,
  startOfPeriod,
  wallTimeCandidates,
  zonedTime,
} from './time-period.js';
import type { TimeGranularity, TimeSelection } from './types.js';

export const timeShortcuts = {
  today: ['day', 0],
  yesterday: ['day', -1],
  'this-week': ['week', 0],
  'last-week': ['week', -1],
  'this-month': ['month', 0],
  'last-month': ['month', -1],
  'this-year': ['year', 0],
  'last-year': ['year', -1],
  'last-7-days': ['day', -6, true],
  'last-30-days': ['day', -29, true],
} as const satisfies Record<string, readonly [TimeGranularity, number, true?]>;
export type TimeShortcut = keyof typeof timeShortcuts;

export function resolveShortcut(
  shortcut: TimeShortcut,
  now: number,
  timeZone: string
): TimeSelection | null {
  const [granularity, offset, range] = timeShortcuts[shortcut];
  try {
    const current = startOfPeriod(now, granularity, timeZone);
    const start = addPeriod(current, granularity, offset, timeZone);
    return normalizeTimeSelection({
      mode: range ? 'range' : 'single',
      granularity,
      timeZone,
      start,
      end: current,
    });
  } catch {
    return null;
  }
}

export function formatTimeSelection(selection: TimeSelection, locale = 'zh-CN'): string {
  const { granularity, mode, timeZone, range } = selection;
  const chinese = locale.startsWith('zh');
  const format = (time: number) => {
    const zoned = zonedTime(time, timeZone);
    const day = zoned.toPlainDate().toString();
    switch (granularity) {
      case 'hour': {
        const clock = String(zoned.hour).padStart(2, '0') + ':00';
        const offset =
          wallTimeCandidates(day, clock, timeZone).length > 1 ? ' (UTC' + zoned.offset + ')' : '';
        return day + ' ' + clock + offset;
      }
      case 'week':
        return chinese
          ? zoned.yearOfWeek + '年第' + zoned.weekOfYear + '周'
          : zoned.yearOfWeek + '-W' + String(zoned.weekOfYear).padStart(2, '0');
      case 'month':
        return day.slice(0, -3);
      case 'year':
        return String(zoned.year) + (chinese ? '年' : '');
      case 'custom': {
        const clock = zoned
          .toPlainTime()
          .toString({ smallestUnit: zoned.millisecond ? 'millisecond' : 'second' });
        const offset =
          wallTimeCandidates(day, clock, timeZone).length > 1 ? ' (UTC' + zoned.offset + ')' : '';
        return day + ' ' + clock + offset;
      }
      default:
        return day;
    }
  };
  const start = format(range.start);
  if (mode === 'single') {
    return start;
  }
  const end = format(range.endExclusive - (mode === 'range' ? 1 : 0));
  return start + ' – ' + end;
}
