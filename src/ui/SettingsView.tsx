/**
 * Project settings view (top-level Settings tab): the scheduling knobs —
 * start / target dates, points↔days conversion, hours per week, the delivery
 * team (resources with FTE, which set capacity + stretch durations), the
 * speed multiplier, and the structural locks. Every edit goes through
 * `updateSettings` / the resource mutations, so it is undoable and autosaved
 * with the graph. Inputs are pre-validated here because those throw on an
 * invalid value and a throwing commit would propagate.
 *
 * Promoted from a header ⚙ popover to a full view (issue #51): the sections
 * had outgrown the cramped popover, so they now lay out as cards.
 *
 * Two columns (issue #61): Team is variable-height (grows with the roster),
 * which broke a uniform card grid — a tall Team card left ragged gaps under
 * its row-mates. Team now sits alone in its own column; the fixed-height
 * sections stack in the other, so neither column's sizing depends on the
 * other's content.
 */

import {
  addResource,
  captureBaseline,
  createId,
  deleteBaseline,
  removeResource,
  renameBaseline,
  updateResource,
  updateSettings,
} from '../model/graph.ts';
import type { DateRange, ProjectSettings } from '../model/types.ts';
import { store, useProjectGraph } from '../store/appStore.ts';
import { DateRangeEditor } from './DateRangeEditor.tsx';
import { HolidayLookup } from './HolidayLookup.tsx';
import { newHolidays } from './holidaySource.ts';

export function SettingsView() {
  const graph = useProjectGraph();
  const s = graph.settings;

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
  function addResourceLeave(id: string, current: DateRange[], range: DateRange) {
    store.commit((g) => updateResource(g, id, { leave: [...current, range] }));
  }
  function removeResourceLeave(id: string, current: DateRange[], index: number) {
    store.commit((g) => updateResource(g, id, { leave: current.filter((_, i) => i !== index) }));
  }

  function addHoliday(range: DateRange) {
    store.commit((g) => updateSettings(g, { holidays: [...g.settings.holidays, range] }));
  }
  function removeHoliday(index: number) {
    store.commit((g) =>
      updateSettings(g, { holidays: g.settings.holidays.filter((_, i) => i !== index) }),
    );
  }
  /** Adds a batch from a country/subdivision lookup in one undo step,
   *  skipping any already present. */
  function addHolidays(ranges: DateRange[]) {
    store.commit((g) =>
      updateSettings(g, { holidays: [...g.settings.holidays, ...newHolidays(ranges, g.settings.holidays)] }),
    );
  }

  /** Commit a lock depth: a non-negative integer (0 = unlocked). */
  function commitLock(field: 'specLockDepth' | 'planLockDepth', raw: string) {
    if (raw.trim() === '') return;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) return;
    commit({ [field]: value }, field);
  }

  function captureNewBaseline() {
    const label = window.prompt('Name this baseline', new Date().toLocaleDateString());
    if (label === null || label.trim() === '') return; // cancelled or blank
    store.commit((g) => captureBaseline(g, label));
  }
  function renameBaselineLabel(id: string, label: string) {
    store.commit((g) => renameBaseline(g, id, label), { coalesce: `baseline-label:${id}` });
  }
  function dropBaseline(id: string) {
    store.commit((g) => deleteBaseline(g, id));
  }

  return (
    <div className="settings-view">
      <div className="settings-columns">
        <div className="settings-col">
          <section className="settings-card">
            <h2 className="settings-card-title">Schedule</h2>
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
          </section>

          <section className="settings-card">
            <h2 className="settings-card-title">Holidays</h2>
            <p className="settings-note">
              Non-working dates for everyone (public holidays, office
              closures) — on top of the weekends the scheduler already skips.
            </p>
            <DateRangeEditor ranges={s.holidays} onAdd={addHoliday} onRemove={removeHoliday} />
            <HolidayLookup
              existingHolidays={s.holidays}
              defaultYear={new Date(`${s.startDate}T00:00:00Z`).getUTCFullYear()}
              onAdd={addHolidays}
            />
          </section>

          <section className="settings-card">
            <h2 className="settings-card-title">Scheduling</h2>
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
          </section>

          <section className="settings-card">
            <h2 className="settings-card-title">Conversion</h2>
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
              · durations ÷ speed, then ÷ each resource's FTE. Weekends,
              holidays, and a resource's own leave are all skipped.
            </p>
          </section>

          <section className="settings-card">
            <h2 className="settings-card-title">Locks</h2>
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
          </section>
        </div>

        <div className="settings-col">
          <section className="settings-card">
            <h2 className="settings-card-title">Team</h2>
            {s.resources.length === 0 ? (
              <p className="settings-note">
                No resources yet — the plan schedules on a single full-time
                track. Add people to parallelise and to assign work.
              </p>
            ) : (
              <div className="resource-list">
                {s.resources.map((r) => (
                  <div className="resource-row" key={r.id}>
                    <div className="resource-row-main">
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
                    <div className="resource-leave">
                      <span className="meta-label">Leave</span>
                      <DateRangeEditor
                        compact
                        ranges={r.leave}
                        onAdd={(range) => addResourceLeave(r.id, r.leave, range)}
                        onRemove={(i) => removeResourceLeave(r.id, r.leave, i)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button className="resource-add" onClick={addTeamResource}>
              + Add resource
            </button>
          </section>

          <section className="settings-card">
            <h2 className="settings-card-title">Baselines</h2>
            <p className="settings-note">
              Named snapshots for drift comparison — capture one, then see what
              changed against it later in Timeline and Metrics.
            </p>
            {s.baselines.length === 0 ? (
              <p className="settings-note">No baselines captured yet.</p>
            ) : (
              <div className="baseline-list">
                {s.baselines.map((b) => (
                  <div className="baseline-row" key={b.id}>
                    <input
                      className="meta-input baseline-label"
                      type="text"
                      placeholder="Untitled"
                      value={b.label}
                      onChange={(e) => renameBaselineLabel(b.id, e.target.value)}
                      onBlur={() => store.breakCoalescing()}
                    />
                    <span className="baseline-date" title={b.capturedAt}>
                      {new Date(b.capturedAt).toLocaleDateString()}
                    </span>
                    <button
                      className="baseline-remove"
                      title="Delete this baseline"
                      onClick={() => dropBaseline(b.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button className="baseline-add" onClick={captureNewBaseline}>
              + Capture baseline
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
