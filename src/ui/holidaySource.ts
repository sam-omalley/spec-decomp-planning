/**
 * Public holiday lookup (issue #121): populates `ProjectSettings.holidays`
 * from a free, keyless, CORS-enabled public holiday API (nager.date) —
 * country- and subdivision-aware (e.g. Australia's states each have their
 * own extra public holidays on top of the national ones), rather than a
 * bundled dataset — no new runtime dependency, at the cost of needing
 * network access. A one-shot lookup-then-add action, never an automatic
 * background refresh: once populated, a project's holiday list is a
 * stable, manually-editable list like any other, via the existing
 * `DateRangeEditor`.
 */

import type { DateRange } from '../model/types.ts';

const API_BASE = 'https://date.nager.at/api/v3';

export interface HolidayCountry {
  countryCode: string;
  name: string;
}

/** Raw shape of a nager.date public holiday entry. */
export interface RemoteHoliday {
  date: string;
  name: string;
  /** Observed nationwide — every subdivision, no `counties` filter needed. */
  global: boolean;
  /** ISO 3166-2 subdivision codes (e.g. `AU-SA`) that observe this holiday
   *  when `global` is false; null when it's not subdivision-specific. */
  counties: string[] | null;
}

export async function fetchCountries(): Promise<HolidayCountry[]> {
  const res = await fetch(`${API_BASE}/AvailableCountries`);
  if (!res.ok) throw new Error('Could not load the country list');
  return res.json();
}

export async function fetchHolidays(year: number, countryCode: string): Promise<RemoteHoliday[]> {
  const res = await fetch(`${API_BASE}/PublicHolidays/${year}/${countryCode}`);
  if (!res.ok) throw new Error('Could not load holidays for that country and year');
  return res.json();
}

/** Every subdivision code observed across `holidays`, sorted — the set a
 *  subdivision picker should offer once a country/year is looked up. */
export function subdivisionsIn(holidays: readonly RemoteHoliday[]): string[] {
  const set = new Set<string>();
  for (const h of holidays) for (const c of h.counties ?? []) set.add(c);
  return [...set].sort();
}

/**
 * The date ranges to add for a lookup: every nationwide holiday, plus —
 * when a subdivision is selected — every holiday observed there. `null`
 * subdivision means national-only (skip subdivision-specific holidays
 * entirely, since none is selected to match against).
 */
export function selectHolidays(
  holidays: readonly RemoteHoliday[],
  subdivision: string | null,
): DateRange[] {
  return holidays
    .filter((h) => h.global || (subdivision !== null && (h.counties ?? []).includes(subdivision)))
    .map((h) => ({ start: h.date, end: h.date }));
}

/** `ranges` with any already present in `existing` (exact start+end match)
 *  dropped — so re-running a lookup, or overlapping two lookups, only adds
 *  what's actually new. */
export function newHolidays(
  ranges: readonly DateRange[],
  existing: readonly DateRange[],
): DateRange[] {
  const seen = new Set(existing.map((r) => `${r.start}:${r.end}`));
  const out: DateRange[] = [];
  for (const r of ranges) {
    const key = `${r.start}:${r.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
