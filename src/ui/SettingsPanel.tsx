/**
 * Project settings popover (header ⚙): the scheduling knobs — start /
 * target dates, points↔days conversion, hours per week, the delivery team
 * (resources with FTE, which set capacity + stretch durations), and the
 * speed multiplier. Every edit goes through `updateSettings` / the resource
 * mutations, so it is undoable and autosaved with the graph. Inputs are
 * pre-validated here because those throw on an invalid value and a throwing
 * commit would propagate.
 */

import { useEffect, useRef, useState } from 'react';
import {
  addResource,
  createId,
  removeResource,
  updateResource,
  updateSettings,
} from '../model/graph.ts';
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
    field: 'pointsPerDay' | 'hoursPerWeek' | 'speedMultiplier',
    raw: string,
    integer = false,
  ) {
    if (raw.trim() === '') return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return;
    if (integer && !Number.isInteger(value)) return;
    commit({ [field]: value }, field);
  }

  function addTeamResource() {
    store.commit((g) => addResource(g, { id: createId(), name: '', fte: 1 }));
  }
  function renameResource(id: string, name: string) {
    store.commit((g) => updateResource(g, id, { name }), { coalesce: `res-name:${id}` });
  }
  function setResourceFte(id: string, raw: string) {
    if (raw.trim() === '') return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return;
    store.commit((g) => updateResource(g, id, { fte: value }), { coalesce: `res-fte:${id}` });
  }
  function dropResource(id: string) {
    store.commit((g) => removeResource(g, id));
  }

  /** Commit a lock depth: a non-negative integer (0 = unlocked). */
  function commitLock(field: 'specLockDepth' | 'planLockDepth', raw: string) {
    if (raw.trim() === '') return;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) return;
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

          <div className="settings-section-label">Team</div>
          {s.resources.length === 0 ? (
            <p className="settings-note">
              No resources yet — the plan schedules on a single full-time
              track. Add people to parallelise and to assign work.
            </p>
          ) : (
            <div className="resource-list">
              {s.resources.map((r) => (
                <div className="resource-row" key={r.id}>
                  <input
                    className="meta-input resource-name"
                    type="text"
                    placeholder="Name"
                    value={r.name}
                    onChange={(e) => renameResource(r.id, e.target.value)}
                    onBlur={() => store.breakCoalescing()}
                  />
                  <label className="resource-fte">
                    <span className="meta-label">FTE</span>
                    <input
                      className="meta-input"
                      type="number"
                      min="0"
                      step="0.1"
                      value={r.fte}
                      onChange={(e) => setResourceFte(r.id, e.target.value)}
                      onBlur={() => store.breakCoalescing()}
                    />
                  </label>
                  <button
                    className="resource-remove"
                    title="Remove this resource"
                    onClick={() => dropResource(r.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <button className="resource-add" onClick={addTeamResource}>
            + Add resource
          </button>

          <div className="settings-section-label">Scheduling</div>
          <div className="meta-row">
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
            <label className="meta-field">
              <span className="meta-label">Hours / week</span>
              <input
                className="meta-input"
                type="number"
                min="0"
                step="1"
                value={s.hoursPerWeek}
                onChange={(e) => commitNumber('hoursPerWeek', e.target.value)}
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
          </div>
          <p className="settings-note">
            Capacity:{' '}
            {s.resources.length === 0
              ? '1 full-time track'
              : `${s.resources.length} resource${s.resources.length === 1 ? '' : 's'}`}{' '}
            · durations ÷ speed, then ÷ each resource's FTE. Weekends are
            skipped.
          </p>

          <div className="settings-section-label">Locks</div>
          <div className="meta-row">
            <label className="meta-field">
              <span className="meta-label">Spec levels</span>
              <input
                className="meta-input"
                type="number"
                min="0"
                step="1"
                value={s.specLockDepth}
                onChange={(e) => commitLock('specLockDepth', e.target.value)}
                onBlur={() => store.breakCoalescing()}
              />
            </label>
            <label className="meta-field">
              <span className="meta-label">Plan levels</span>
              <input
                className="meta-input"
                type="number"
                min="0"
                step="1"
                value={s.planLockDepth}
                onChange={(e) => commitLock('planLockDepth', e.target.value)}
                onBlur={() => store.breakCoalescing()}
              />
            </label>
          </div>
          <p className="settings-note">
            Freeze the top levels against accidental edits (0 = off). Locked
            rows keep their shape and name; you can still add children below,
            assign work, and edit plan fields. 🔒
          </p>
        </div>
      )}
    </div>
  );
}
