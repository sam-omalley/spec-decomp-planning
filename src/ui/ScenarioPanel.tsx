/**
 * "What-if" toggle + override form for Reporting's Timeline/Metrics: lets
 * you diverge the team and speed multiplier for those two views only,
 * without touching the real graph (see `scenario.ts`). Shared by both
 * views (rendered once in `App.tsx`'s Reporting header) so switching
 * between them keeps the same scenario active.
 */

import { useState } from 'react';
import { createId } from '../model/graph.ts';
import type { ProjectSettings } from '../model/types.ts';
import { scenarioFrom, type ScenarioPatch } from './scenario.ts';

interface ScenarioPanelProps {
  value: ScenarioPatch | null;
  onChange: (patch: ScenarioPatch | null) => void;
  baseSettings: ProjectSettings;
}

export function ScenarioPanel({ value, onChange, baseSettings }: ScenarioPanelProps) {
  const [open, setOpen] = useState(false);
  const active = value !== null;

  function start() {
    onChange(scenarioFrom(baseSettings));
    setOpen(true);
  }
  function exit() {
    onChange(null);
    setOpen(false);
  }
  function patch(next: Partial<ScenarioPatch>) {
    if (value) onChange({ ...value, ...next });
  }
  function addResource() {
    if (!value) return;
    patch({
      resources: [...value.resources, { id: createId(), name: '', fte: 1, leave: [] }],
    });
  }
  function renameResource(id: string, name: string) {
    if (!value) return;
    patch({ resources: value.resources.map((r) => (r.id === id ? { ...r, name } : r)) });
  }
  function setResourceFte(id: string, raw: string) {
    if (!value) return;
    const fte = Number(raw);
    if (!Number.isFinite(fte) || fte <= 0) return;
    patch({ resources: value.resources.map((r) => (r.id === id ? { ...r, fte } : r)) });
  }
  function removeResource(id: string) {
    if (!value) return;
    patch({ resources: value.resources.filter((r) => r.id !== id) });
  }
  function setSpeed(raw: string) {
    const speedMultiplier = Number(raw);
    if (!Number.isFinite(speedMultiplier) || speedMultiplier <= 0) return;
    patch({ speedMultiplier });
  }

  return (
    <div className="scenario-panel">
      <button
        type="button"
        className={`scenario-toggle${active ? ' scenario-toggle-active' : ''}`}
        onClick={() => (active ? setOpen((o) => !o) : start())}
        title="Try a hypothetical team/speed change without touching the real plan"
      >
        🔀 What-if{active ? ' — on' : ''}
      </button>
      {active && (
        <span className="scenario-banner">
          Viewing a scenario, not the real plan
          <button type="button" className="scenario-exit" onClick={exit}>
            Exit
          </button>
        </span>
      )}
      {active && open && value && (
        <div className="scenario-form">
          <label className="scenario-speed">
            Speed ×
            <input
              type="number"
              min="0"
              step="0.1"
              value={value.speedMultiplier}
              onChange={(e) => setSpeed(e.target.value)}
            />
          </label>
          <div className="scenario-resources">
            {value.resources.map((r) => (
              <div className="scenario-resource-row" key={r.id}>
                <input
                  type="text"
                  placeholder="Name"
                  value={r.name}
                  onChange={(e) => renameResource(r.id, e.target.value)}
                />
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={r.fte}
                  onChange={(e) => setResourceFte(r.id, e.target.value)}
                  title="FTE"
                />
                <button
                  type="button"
                  className="scenario-resource-remove"
                  title="Remove from the scenario team"
                  onClick={() => removeResource(r.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="scenario-resource-add" onClick={addResource}>
            + Add resource
          </button>
        </div>
      )}
    </div>
  );
}
