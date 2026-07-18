/**
 * Shared helpers for the plan's actual-date fields (`actualStart` /
 * `actualFinish`), which store either a bare ISO date (`YYYY-MM-DD` —
 * legacy, or simply no time entered) or an ISO datetime-local value
 * (`YYYY-MM-DDTHH:MM`). Both are interpreted as UTC wall-clock instants so
 * calendar math stays timezone-independent; a bare date means "start of
 * that day" (00:00) — the honest reading of timeless data, not a rounded-up
 * end-of-day guess.
 */

const DAY_MS = 86_400_000;

/** The instant (ms since epoch) an actual-date(time) string denotes. */
function toInstant(iso: string): number {
  return iso.length <= 10 ? Date.parse(`${iso}T00:00:00Z`) : Date.parse(`${iso}:00Z`);
}

/** The calendar-date portion (`YYYY-MM-DD`), for day-granular consumers
 *  (the scheduler, calendar-day metrics) that don't care about time-of-day. */
export function toDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** The `YYYY-MM-DD` portion for a `<input type="date">`, or '' if unset. */
export function toDateInputValue(iso: string | null): string {
  return iso ? toDateOnly(iso) : '';
}

/** The `HH:MM` portion for a `<input type="time">`, or '' for a bare date
 *  (no time set) or unset. */
export function toTimeInputValue(iso: string | null): string {
  return iso && iso.length > 10 ? iso.slice(11, 16) : '';
}

/** Combine separate date/time input values back into the stored
 *  actual-date(time) format: a bare date if no time is set, otherwise an
 *  ISO datetime-local string. `date` empty means "clear the field". */
export function combineDateAndTime(date: string, time: string): string | null {
  if (!date) return null;
  return time ? `${date}T${time}` : date;
}

/**
 * Elapsed duration between two actual-date(time)s, in 24-hour days, with
 * weekend time removed — the "actual" counterpart to the scheduler's
 * skip-weekends working days. E.g. Wed 00:00 → Thu 00:00 is 1.0 day; a
 * same-day 09:00–17:00 span is 8/24 day; a span crossing a weekend has
 * that weekend's hours subtracted (whole or partial). 0 if finish ≤ start.
 */
export function elapsedWorkingDays(startIso: string, finishIso: string): number {
  const start = toInstant(startIso);
  const finish = toInstant(finishIso);
  if (finish <= start) return 0;
  let ms = finish - start;
  const firstDay = Math.floor(start / DAY_MS) * DAY_MS;
  for (let t = firstDay; t < finish; t += DAY_MS) {
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) {
      const overlapStart = Math.max(t, start);
      const overlapEnd = Math.min(t + DAY_MS, finish);
      if (overlapEnd > overlapStart) ms -= overlapEnd - overlapStart;
    }
  }
  return ms / DAY_MS;
}
