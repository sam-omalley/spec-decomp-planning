/**
 * "Compare to baseline" dropdown for Reporting's Timeline/Metrics (#131) —
 * shared by both views (rendered once in App.tsx's Reporting header, next
 * to the what-if scenario toggle) so switching between them keeps the same
 * baseline selected. Purely a view-state selector; the actual drift
 * computation (`baselineDrift.ts`) lives in each consuming view.
 */

import type { Baseline } from '../model/types.ts';

interface BaselineSelectorProps {
  baselines: Baseline[];
  value: string | null;
  onChange: (id: string | null) => void;
}

export function BaselineSelector({ baselines, value, onChange }: BaselineSelectorProps) {
  if (baselines.length === 0) return null;
  return (
    <label className="baseline-selector" title="Compare the current plan against a captured baseline">
      <span className="baseline-selector-label">vs.</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">Current plan only</option>
        {baselines.map((b) => (
          <option key={b.id} value={b.id}>
            {b.label.trim() || 'Untitled'}
          </option>
        ))}
      </select>
    </label>
  );
}
