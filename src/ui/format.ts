/**
 * Display formatting for the day-count metrics (estimate/actual/variance)
 * that can now carry sub-day fractions since actual dates may include a
 * time-of-day (`elapsedWorkingDays` in `src/model/time.ts`). Rounds to at
 * most one decimal place and drops a trailing `.0` for whole numbers.
 */
export function formatDays(days: number): string {
  const rounded = Math.round(days * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
