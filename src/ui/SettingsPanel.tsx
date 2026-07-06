/**
 * Project settings popover (header ⚙): the scheduling knobs — start /
 * target dates, points↔days conversion, hours per day, and the two
 * capacity controls (parallel tracks + speed multiplier). Every edit goes
 * through `updateSettings`, so it is undoable and autosaved with the
 * graph. Inputs are pre-validated here because `updateSettings` throws on
 * an invalid value and a throwing commit would propagate.
 */

import { useEffect, useRef, useState } from 'react';
import { updateSettings } from '../model/graph.ts';
import type { ProjectSettings } from '../model/types.ts';
import { store, useProjectGraph } from '../store/appStore.ts';

export function SettingsPanel() {
  const graph = useProjectGraph();
  const s = graph.settings;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function commit(patch: Partial<ProjectSettings>, field: string) {
    store.commit((g) => updateSettings(g, patch), { coalesce: `settings:${field}` });
  }

  /** Commit a positive number (optionally integer); ignore invalid input. */
  function commitNumber(
    field: 'pointsPerDay' | 'hoursPerDay' | 'parallelTracks' | 'speedMultiplier',
    raw: string,
    integer = false,
  ) {
    if (raw.trim() === '') return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return;
    if (integer && !Number.isInteger(value)) return;
    commit({ [field]: value }, field);
  }

  return (
    <div className="settings-wrap" ref={ref}>
      <button
        className={`settings-trigger${open ? ' settings-trigger-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Project & scheduling settings"
      >
        ⚙ Settings
      </button>
      {open && (
        <div className="settings-panel">
          <div className="settings-section-label">Schedule</div>
          <div className="meta-row">
            <label className="meta-field">
              <span className="meta-label">Start date</span>
              <input
                className="meta-input"
                type="date"
                value={s.startDate}
                onChange={(e) => {
                  if (e.target.value) commit({ startDate: e.target.value }, 'startDate');
                }}
              />
            </label>
            <label className="meta-field">
              <span className="meta-label">Target date</span>
              <input
                className="meta-input"
                type="date"
                value={s.targetDate ?? ''}
                onChange={(e) => commit({ targetDate: e.target.value || null }, 'targetDate')}
              />
            </label>
          </div>

          <div className="settings-section-label">Capacity</div>
          <div className="meta-row">
            <label className="meta-field">
              <span className="meta-label">Parallel tracks</span>
              <input
                className="meta-input"
                type="number"
                min="1"
                step="1"
                value={s.parallelTracks}
                onChange={(e) => commitNumber('parallelTracks', e.target.value, true)}
                onBlur={() => store.breakCoalescing()}
              />
            </label>
            <label className="meta-field">
              <span className="meta-label">Speed ×</span>
              <input
                className="meta-input"
                type="number"
                min="0"
                step="0.1"
                value={s.speedMultiplier}
                onChange={(e) => commitNumber('speedMultiplier', e.target.value)}
                onBlur={() => store.breakCoalescing()}
              />
            </label>
          </div>

          <div className="settings-section-label">Conversion</div>
          <div className="meta-row">
            <label className="meta-field">
              <span className="meta-label">Points / day</span>
              <input
                className="meta-input"
                type="number"
                min="0"
                step="0.1"
                value={s.pointsPerDay}
                onChange={(e) => commitNumber('pointsPerDay', e.target.value)}
                onBlur={() => store.breakCoalescing()}
              />
            </label>
            <label className="meta-field">
              <span className="meta-label">Hours / day</span>
              <input
                className="meta-input"
                type="number"
                min="0"
                step="0.5"
                value={s.hoursPerDay}
                onChange={(e) => commitNumber('hoursPerDay', e.target.value)}
                onBlur={() => store.breakCoalescing()}
              />
            </label>
          </div>
          <p className="settings-note">
            Capacity: {s.parallelTracks} track{s.parallelTracks === 1 ? '' : 's'} · durations ÷{' '}
            {s.speedMultiplier}. Weekends are skipped.
          </p>
        </div>
      )}
    </div>
  );
}
