/**
 * Compact editor for a list of date ranges — project holidays or a
 * resource's individual leave (`ProjectSettings.holidays` /
 * `Resource.leave`). Existing ranges render as removable chips; adding one
 * needs both a start and end date (start ≤ end), mirroring `KeyEditor`'s
 * add-when-valid gating.
 */

import { useState } from 'react';
import type { DateRange } from '../model/types.ts';

interface DateRangeEditorProps {
  ranges: DateRange[];
  onAdd: (range: DateRange) => void;
  onRemove: (index: number) => void;
  /** Tighter layout for dense contexts (a resource row). */
  compact?: boolean;
}

export function DateRangeEditor({ ranges, onAdd, onRemove, compact }: DateRangeEditorProps) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const canAdd = start !== '' && end !== '' && start <= end;

  function add() {
    if (!canAdd) return;
    onAdd({ start, end });
    setStart('');
    setEnd('');
  }

  return (
    <div className={`date-range-editor${compact ? ' date-range-editor-compact' : ''}`}>
      {ranges.map((r, i) => (
        <span className="date-range-chip" key={`${r.start}:${r.end}`}>
          {r.start === r.end ? r.start : `${r.start} → ${r.end}`}
          <button className="icon-button" title="Remove" onClick={() => onRemove(i)}>
            ×
          </button>
        </span>
      ))}
      <span className="date-range-add">
        <input
          className="meta-input date-range-input"
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        <input
          className="meta-input date-range-input"
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
        <button className="icon-button" disabled={!canAdd} title="Add" onClick={add}>
          +
        </button>
      </span>
    </div>
  );
}
