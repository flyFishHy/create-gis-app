import { Temporal } from '@js-temporal/polyfill'
import {
  timeGranularities,
  timeSelectionModes,
  type TimeGranularity,
  type TimePickerDraft,
  type TimeSelection,
} from './types.js'

type TimeInput = Pick<TimePickerDraft, 'mode' | 'timeZone' | 'start' | 'end'> & {
  granularity: TimeGranularity | 'custom'
}

export function isTimeZone(timeZone: string) {
  try {
    if (!timeZone || /^[+-]/.test(timeZone)) return false
    new Intl.DateTimeFormat('en', { timeZone })
    return true
  } catch {
    return false
  }
}

export function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= 8.64e15
}

export function zonedTime(time: number, timeZone: string) {
  return Temporal.Instant.fromEpochMilliseconds(time).toZonedDateTimeISO(timeZone)
}

export function startOfPeriod(
  time: number,
  granularity: TimeGranularity,
  timeZone: string
): number {
  const date = zonedTime(time, timeZone)
  switch (granularity) {
    case 'hour':
      return date.with({ minute: 0, second: 0, millisecond: 0 }).epochMilliseconds
    case 'day':
      return date.startOfDay().epochMilliseconds
    case 'week':
      return date
        .toPlainDate()
        .subtract({ days: date.dayOfWeek - 1 })
        .toZonedDateTime(timeZone).epochMilliseconds
    case 'month':
      return date.toPlainDate().with({ day: 1 }).toZonedDateTime(timeZone).epochMilliseconds
    case 'year':
      return date.toPlainDate().with({ month: 1, day: 1 }).toZonedDateTime(timeZone)
        .epochMilliseconds
    default:
      throw new RangeError('Unsupported time granularity.')
  }
}

export function addPeriod(
  time: number,
  granularity: TimeGranularity,
  amount: number,
  timeZone: string
): number {
  const date = zonedTime(time, timeZone)
  const plain = date.toPlainDate()
  switch (granularity) {
    case 'hour':
      return date.add({ hours: amount }).epochMilliseconds
    case 'day':
      return plain.add({ days: amount }).toZonedDateTime(timeZone).epochMilliseconds
    case 'week': {
      const monday = plain.subtract({ days: date.dayOfWeek - 1 })
      return monday.add({ weeks: amount }).toZonedDateTime(timeZone).epochMilliseconds
    }
    case 'month':
      return plain.with({ day: 1 }).add({ months: amount }).toZonedDateTime(timeZone)
        .epochMilliseconds
    case 'year':
      return plain.with({ month: 1, day: 1 }).add({ years: amount }).toZonedDateTime(timeZone)
        .epochMilliseconds
    default:
      throw new RangeError('Unsupported time granularity.')
  }
}

export function normalizeTimeSelection(input: TimeInput): TimeSelection | null {
  const { mode, granularity, timeZone, start, end } = input
  if (!timeSelectionModes.includes(mode) || !isTimeZone(timeZone) || !isTimestamp(start))
    return null
  if (mode !== 'single' && (!isTimestamp(end) || start > end)) return null
  if (mode === 'custom-range') {
    return isTimestamp(end) && start < end
      ? { mode, granularity: 'custom', timeZone, range: { start, endExclusive: end } }
      : null
  }
  if (granularity === 'custom' || !timeGranularities.includes(granularity)) return null
  try {
    const first = startOfPeriod(start, granularity, timeZone)
    const last = mode === 'single' ? first : startOfPeriod(end!, granularity, timeZone)
    const endExclusive = addPeriod(last, granularity, 1, timeZone)
    return first < endExclusive
      ? { mode, granularity, timeZone, range: { start: first, endExclusive } }
      : null
  } catch {
    return null
  }
}

/** Exact wall-clock mappings. A gap has no candidates and a repeated hour has two. */
export function wallTimeCandidates(date: string, clock: string, timeZone: string) {
  try {
    const wall = Temporal.PlainDateTime.from(date + 'T' + clock)
    const candidates = (['earlier', 'later'] as const).map((disambiguation) =>
      wall.toZonedDateTime(timeZone, { disambiguation })
    )
    return candidates.filter(
      (value, index) =>
        value.toPlainDateTime().equals(wall) &&
        (index === 0 || value.epochMilliseconds !== candidates[0]!.epochMilliseconds)
    )
  } catch {
    return []
  }
}

export function calendarDate(date: string, timeZone: string) {
  try {
    const plain = Temporal.PlainDate.from(date)
    const value = plain.toZonedDateTime(timeZone)
    return value.toPlainDate().equals(plain) ? value.epochMilliseconds : undefined
  } catch {
    return undefined
  }
}
