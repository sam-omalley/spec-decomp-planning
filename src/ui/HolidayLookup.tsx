/**
 * "Populate from country" sub-section of the Holidays settings card
 * (issue #121): look up a country/year's public holidays, optionally
 * narrow to a subdivision (state/province — some countries have their own
 * extra holidays on top of the national ones), preview the count, and add
 * them to `settings.holidays` in one step. A lookup, not a sync: nothing
 * here runs again on its own, and everything it adds is then just a plain
 * editable/removable entry in the existing `DateRangeEditor` list above.
 */

import { useState } from 'react';
import type { DateRange } from '../model/types.ts';
import {
  fetchCountries,
  fetchHolidays,
  newHolidays,
  selectHolidays,
  subdivisionsIn,
  type HolidayCountry,
  type RemoteHoliday,
} from './holidaySource.ts';

interface HolidayLookupProps {
  existingHolidays: DateRange[];
  defaultYear: number;
  onAdd: (ranges: DateRange[]) => void;
}

/** `AU-SA` → `SA` for a compact option label; falls back to the full code
 *  for anything that isn't a plain `XX-YYY` ISO 3166-2 shape. */
function subdivisionLabel(code: string, countryCode: string): string {
  return code.startsWith(`${countryCode}-`) ? code.slice(countryCode.length + 1) : code;
}

export function HolidayLookup({ existingHolidays, defaultYear, onAdd }: HolidayLookupProps) {
  const [countries, setCountries] = useState<HolidayCountry[] | null>(null);
  const [countriesError, setCountriesError] = useState<string | null>(null);
  // Loaded lazily — on first focus of the country picker, not on mount —
  // so opening Settings never hits the API for the (common) case where
  // holiday lookup isn't touched this visit; a fetch failure is then only
  // ever surfaced if someone actually opens the picker.
  const [countriesRequested, setCountriesRequested] = useState(false);
  const [country, setCountry] = useState('');
  const [year, setYear] = useState(defaultYear);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'loaded'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [holidays, setHolidays] = useState<RemoteHoliday[]>([]);
  const [subdivision, setSubdivision] = useState<string | null>(null);

  function loadCountries() {
    if (countriesRequested) return;
    setCountriesRequested(true);
    fetchCountries()
      .then((list) => {
        setCountries(list);
        setCountry((c) => c || list[0]?.countryCode || '');
      })
      .catch(() => setCountriesError('Could not load the country list — check your connection.'));
  }

  function lookup() {
    if (!country) return;
    setStatus('loading');
    setError(null);
    fetchHolidays(year, country)
      .then((list) => {
        setHolidays(list);
        setSubdivision(null);
        setStatus('loaded');
      })
      .catch(() => {
        setStatus('error');
        setError('Could not load holidays for that country and year.');
      });
  }

  const subdivisions = status === 'loaded' ? subdivisionsIn(holidays) : [];
  const selected = status === 'loaded' ? selectHolidays(holidays, subdivision) : [];
  const additions = newHolidays(selected, existingHolidays);

  return (
    <div className="holiday-lookup">
      <div className="holiday-lookup-row">
        <select
          className="meta-input"
          value={country}
          onFocus={loadCountries}
          onChange={(e) => {
            setCountry(e.target.value);
            setStatus('idle');
          }}
        >
          {!countries && (
            <option value="">
              {!countriesRequested
                ? 'Select a country…'
                : countriesError
                  ? 'Country list unavailable'
                  : 'Loading countries…'}
            </option>
          )}
          {countries?.map((c) => (
            <option key={c.countryCode} value={c.countryCode}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          className="meta-input holiday-lookup-year"
          type="number"
          value={year}
          onChange={(e) => {
            const y = Number(e.target.value);
            if (Number.isInteger(y)) setYear(y);
            setStatus('idle');
          }}
        />
        <button type="button" onClick={lookup} disabled={!country || status === 'loading'}>
          {status === 'loading' ? 'Looking up…' : 'Look up'}
        </button>
      </div>
      {countriesError && <p className="holiday-lookup-error">{countriesError}</p>}
      {status === 'error' && error && <p className="holiday-lookup-error">{error}</p>}
      {status === 'loaded' && (
        <div className="holiday-lookup-result">
          {subdivisions.length > 0 && (
            <label className="holiday-lookup-subdivision">
              State/province
              <select
                className="meta-input"
                value={subdivision ?? ''}
                onChange={(e) => setSubdivision(e.target.value || null)}
              >
                <option value="">National only</option>
                {subdivisions.map((s) => (
                  <option key={s} value={s}>
                    {subdivisionLabel(s, country)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="holiday-lookup-preview">
            <span>
              {selected.length} holiday{selected.length === 1 ? '' : 's'} found
              {additions.length !== selected.length ? `, ${additions.length} new` : ''}
            </span>
            <button type="button" disabled={additions.length === 0} onClick={() => onAdd(additions)}>
              Add {additions.length > 0 ? additions.length : ''} to holidays
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
