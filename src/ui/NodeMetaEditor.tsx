/**
 * Metadata fields inside a group row's details card: status, priority,
 * the two estimate axes (points + duration in days), an optional
 * optimistic/pessimistic range on the duration for the sampled projection
 * (#133), actual start/finish dates, and external-tracker keys. Status and
 * effort were modelled from slice 1 but never had a surface; the rest
 * arrived with the project-management extension (slice 8). Key entry lives
 * in the shared `KeyEditor` (key-only, defaulting to Jira).
 */

import { assignResource, setActualDates, setEstimate, updateNode } from '../model/graph.ts';
import type { Priority, Status } from '../model/types.ts';
import { store, useProjectGraph } from '../store/appStore.ts';
import { ActualDateInput } from './ActualDateInput.tsx';
import { InfoDot } from './InfoDot.tsx';
import { KeyEditor } from './KeyEditor.tsx';

const STATUSES: Status[] = ['not_started', 'in_progress', 'blocked', 'done'];
const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'critical'];

interface NodeMetaEditorProps {
  id: string;
}

export function NodeMetaEditor({ id }: NodeMetaEditorProps) {
  const graph = useProjectGraph();
  const node = graph.nodes[id];
  if (!node) return null;

  /** Parse a numeric field: blank clears (null); reject negatives/garbage. */
  function numberFor(raw: string): number | null | undefined {
    if (raw.trim() === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  function setEffort(raw: string) {
    const value = numberFor(raw);
    if (value === undefined) return;
    store.commit((g) => setEstimate(g, id, { effort: value }), {
      coalesce: `effort:${id}`,
    });
  }

  function setDuration(raw: string) {
    const value = numberFor(raw);
    if (value === undefined) return;
    store.commit((g) => setEstimate(g, id, { durationEstimate: value }), {
      coalesce: `duration:${id}`,
    });
  }

  function setOptimistic(raw: string) {
    const value = numberFor(raw);
    if (value === undefined) return;
    store.commit((g) => setEstimate(g, id, { durationOptimistic: value }), {
      coalesce: `duration-opt:${id}`,
    });
  }

  function setPessimistic(raw: string) {
    const value = numberFor(raw);
    if (value === undefined) return;
    store.commit((g) => setEstimate(g, id, { durationPessimistic: value }), {
      coalesce: `duration-pess:${id}`,
    });
  }

  return (
    <div className="meta-editor">
      <div className="meta-row">
        <label className="meta-field">
          <span className="meta-label">Status</span>
          <select
            className="meta-select"
            value={node.status}
            onChange={(e) =>
              store.commit((g) => updateNode(g, id, { status: e.target.value as Status }))
            }
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="meta-field">
          <span className="meta-label">Priority</span>
          <select
            className="meta-select"
            value={node.priority}
            onChange={(e) =>
              store.commit((g) => updateNode(g, id, { priority: e.target.value as Priority }))
            }
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="meta-row">
        <label className="meta-field">
          <span className="meta-label">Resource</span>
          <select
            className="meta-select"
            value={node.resourceId ?? ''}
            onChange={(e) =>
              store.commit((g) => assignResource(g, id, e.target.value || null))
            }
          >
            <option value="">Unassigned</option>
            {graph.settings.resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name.trim() || 'Unnamed'}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="meta-row">
        <label className="meta-field">
          <span className="meta-label">Points</span>
          <input
            className="meta-input"
            type="number"
            min="0"
            step="0.5"
            placeholder="—"
            value={node.effort ?? ''}
            onChange={(e) => setEffort(e.target.value)}
            onBlur={() => store.breakCoalescing()}
          />
        </label>
        <label className="meta-field">
          <span className="meta-label">Duration (days)</span>
          <input
            className="meta-input"
            type="number"
            min="0"
            step="0.5"
            placeholder="—"
            value={node.durationEstimate ?? ''}
            onChange={(e) => setDuration(e.target.value)}
            onBlur={() => store.breakCoalescing()}
          />
        </label>
      </div>

      <div className="meta-row">
        <label className="meta-field">
          <span className="meta-label">
            Optimistic (days)
            <InfoDot
              text="The best case for this unit's duration — used together with Pessimistic to sample a P50/P80 projection range (Reporting → Metrics) instead of a single hard date. Leave both blank to let it use this project's own historical estimate accuracy once there's enough completed history; either alone is ignored."
              align="start"
            />
          </span>
          <input
            className="meta-input"
            type="number"
            min="0"
            step="0.5"
            placeholder="—"
            value={node.durationOptimistic ?? ''}
            onChange={(e) => setOptimistic(e.target.value)}
            onBlur={() => store.breakCoalescing()}
          />
        </label>
        <label className="meta-field">
          <span className="meta-label">Pessimistic (days)</span>
          <input
            className="meta-input"
            type="number"
            min="0"
            step="0.5"
            placeholder="—"
            value={node.durationPessimistic ?? ''}
            onChange={(e) => setPessimistic(e.target.value)}
            onBlur={() => store.breakCoalescing()}
          />
        </label>
      </div>

      <div className="meta-row">
        <label className="meta-field">
          <span className="meta-label">Actual start</span>
          <ActualDateInput
            value={node.actualStart}
            onChange={(value) =>
              store.commit((g) => setActualDates(g, id, { actualStart: value }), {
                coalesce: `actual-start:${id}`,
              })
            }
          />
        </label>
        <label className="meta-field">
          <span className="meta-label">Actual finish</span>
          <ActualDateInput
            value={node.actualFinish}
            onChange={(value) =>
              store.commit((g) => setActualDates(g, id, { actualFinish: value }), {
                coalesce: `actual-finish:${id}`,
              })
            }
          />
        </label>
      </div>

      <div className="meta-refs">
        <span className="meta-label">Keys</span>
        <KeyEditor id={id} />
      </div>
    </div>
  );
}
