import { isTimestamp, isTimeZone, normalizeTimeSelection, startOfPeriod } from './time-period.js';
import type { TimeGranularity, TimeSelection, TimeSelectionMode } from './types.js';

type DraftEndpoints = { timeZone: string; start?: number; end?: number };
export type TimeDraft = DraftEndpoints &
  (
    | { mode: 'single' | 'range'; granularity: TimeGranularity }
    | { mode: 'range'; granularity: 'datetime' }
  );

export function toDraft(
  value: TimeSelection | null | undefined,
  mode: TimeSelectionMode,
  granularity: TimeGranularity,
  timeZone: string
): TimeDraft {
  const base: TimeDraft =
    mode === 'custom-range'
      ? { mode: 'range', granularity: 'datetime', timeZone }
      : { mode, granularity, timeZone };
  const range = value?.range;
  if (
    !range ||
    !isTimeZone(timeZone) ||
    !isTimestamp(range.start) ||
    !isTimestamp(range.endExclusive) ||
    range.start >= range.endExclusive
  ) {
    return base;
  }
  if (base.granularity === 'datetime') {
    return { ...base, start: range.start, end: range.endExclusive };
  }
  try {
    return {
      ...base,
      start: startOfPeriod(range.start, base.granularity, timeZone),
      end:
        base.mode === 'range'
          ? startOfPeriod(range.endExclusive - 1, base.granularity, timeZone)
          : undefined,
    };
  } catch {
    return base;
  }
}

export function fromDraft(draft: TimeDraft): TimeSelection | null {
  return normalizeTimeSelection(
    draft.granularity === 'datetime'
      ? { ...draft, mode: 'custom-range', granularity: 'custom' }
      : draft
  );
}

export function switchDraft(
  draft: TimeDraft,
  mode: TimeSelectionMode,
  granularity: TimeGranularity
): TimeDraft {
  const range = fromDraft(draft)?.range;
  const start = range?.start ?? draft.start;
  const end =
    mode === 'single' || !range ? undefined : range.endExclusive - (mode === 'range' ? 1 : 0);
  const next: TimeDraft =
    mode === 'custom-range'
      ? { mode: 'range', granularity: 'datetime', timeZone: draft.timeZone, start, end }
      : { mode, granularity, timeZone: draft.timeZone, start, end };
  const aligned = fromDraft(next);
  return aligned ? toDraft(aligned, mode, granularity, draft.timeZone) : next;
}

export function sameTimeSelection(left: TimeSelection, right: TimeSelection | null | undefined) {
  return (
    right?.mode === left.mode &&
    right.granularity === left.granularity &&
    right.timeZone === left.timeZone &&
    right.range?.start === left.range.start &&
    right.range?.endExclusive === left.range.endExclusive
  );
}
