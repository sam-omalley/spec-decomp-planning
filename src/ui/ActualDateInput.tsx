/**
 * Editor for an actual-date(time) field (`actualStart` / `actualFinish`):
 * a required date plus an optional time, kept as two separate native
 * inputs rather than one `<input type="datetime-local">`. A single
 * datetime-local input only fires `onChange` once both the date *and*
 * time sub-fields are complete, so entering just a date and tabbing away
 * silently discards it (#123) even though the model happily stores a bare
 * date. Splitting the fields makes the date alone a complete, savable
 * value, and the time an explicit add-on.
 */

import { combineDateAndTime, toDateInputValue, toTimeInputValue } from '../model/time.ts';

interface ActualDateInputProps {
  value: string | null;
  onChange: (value: string | null) => void;
  /** Tighter layout for dense contexts (the plan table cell). */
  compact?: boolean;
}

export function ActualDateInput({ value, onChange, compact }: ActualDateInputProps) {
  const date = toDateInputValue(value);
  const time = toTimeInputValue(value);
  const inputClass = compact ? 'cell-input cell-date-part' : 'meta-input';

  return (
    <span className={`actual-date-input${compact ? ' actual-date-input-compact' : ''}`}>
      <input
        className={inputClass}
        type="date"
        value={date}
        onChange={(e) => onChange(combineDateAndTime(e.target.value, time))}
      />
      <input
        className={`${inputClass} actual-date-time`}
        type="time"
        value={time}
        disabled={!date}
        title={!date ? 'Set a date first' : undefined}
        onChange={(e) => onChange(combineDateAndTime(date, e.target.value))}
      />
    </span>
  );
}
