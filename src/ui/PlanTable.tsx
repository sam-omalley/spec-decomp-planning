/**
 * Tabular editor for the delivery plan (group side): one row per group in
 * pre-order, every plan field a column. A projection of the same graph as
 * the plan outliner — it reuses the exact mutations `NodeMetaEditor` uses
 * (updateNode / setEstimate / setActualDates), so edits round-trip and
 * undo identically. Multi-select (⇧/⌘ click, ⇧+Arrow) lets a field edit
 * fan out to every selected row in one undo step.
 *
 * Only the plan carries these fields; the spec stays structural, so there
 * is no spec-side table.
 */

import { useMemo } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { cycleIndexOf, waitingMap } from '../model/analysis.ts';
import { assignResource, setActualDates, setEstimate, updateNode } from '../model/graph.ts';
import { rolledDuration, rolledEffort } from '../model/rollup.ts';
import type { Priority, ProjectGraph, Status } from '../model/types.ts';
import { store, useProjectGraph } from '../store/appStore.ts';
import { EMPTY_FILTER, isFilterActive, matchesFilter, type FilterState } from './filter.ts';
import { KeyEditor } from './KeyEditor.tsx';
import { isLocked } from './locks.ts';
import { treeDepth, visibleRows } from './outline.ts';
import { useMultiSelect } from './useMultiSelect.ts';

const STATUSES: Status[] = ['not_started', 'in_progress', 'blocked', 'done'];
const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'critical'];
const NO_COLLAPSE: ReadonlySet<string> = new Set();

interface PlanTableProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Global filter, shared across tabs. */
  filter?: FilterState;
  /** Jump to a group's definition in the outline (de-truncation / detail). */
  onReveal?: (id: string) => void;
}

export function PlanTable({
  selectedId,
  onSelect,
  filter = EMPTY_FILTER,
  onReveal,
}: PlanTableProps) {
  const graph = useProjectGraph();
  const filterActive = isFilterActive(filter);
  const rows = useMemo(
    () =>
      visibleRows(
        graph,
        NO_COLLAPSE,
        'group',
        filterActive ? (id) => matchesFilter(graph.nodes[id]!, filter) : undefined,
      ),
    [graph, filterActive, filter],
  );
  const orderedIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const multi = useMultiSelect(orderedIds, selectedId, onSelect);
  const waiting = useMemo(() => waitingMap(graph), [graph]);
  const cycles = useMemo(() => cycleIndexOf(graph), [graph]);
  // Levels that actually exist, so a lock deeper than the tree cannot
  // freeze a phantom level.
  const levels = useMemo(() => treeDepth(graph, 'group'), [graph]);

  /** Fan a mutation out over the selection when this row is part of it. */
  function targetsFor(id: string): string[] {
    return multi.size > 1 && multi.selected.has(id) ? [...multi.selected] : [id];
  }

  function bulkCommit(
    id: string,
    mutate: (g: ProjectGraph, target: string) => ProjectGraph,
    coalesce?: string,
  ) {
    const targets = targetsFor(id);
    store.commit(
      (g) => {
        let next = g;
        for (const t of targets) if (next.nodes[t]) next = mutate(next, t);
        return next;
      },
      coalesce ? { coalesce } : undefined,
    );
  }

  /** Parse a numeric field: blank clears (null); reject negatives/garbage. */
  function numberFor(raw: string): number | null | undefined {
    if (raw.trim() === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  function onRowMouseDown(id: string, event: MouseEvent) {
    // A plain click on a form control inside a row that is already part of a
    // multi-selection must NOT collapse the selection: the edit that follows
    // (dropdown change, typing) is meant to fan out across the whole
    // selection, and collapsing first would strand it on this single row
    // (#48 — bulk-setting Assignee cleared the selection). Modifier clicks
    // still extend/toggle; plain clicks on an unselected row still collapse.
    const onControl = (event.target as HTMLElement).closest(
      'input, select, textarea, button',
    );
    if (
      onControl &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      multi.size > 1 &&
      multi.isSelected(id)
    ) {
      return;
    }
    // Always route through the hook: ⇧/⌘ extend or toggle (and preventDefault
    // to preserve focus), while a plain click collapses the selection back to
    // this row — otherwise a shift-selected range stays highlighted even after
    // clicking away. The plain branch does not preventDefault, so inputs and
    // selects still focus and edit normally.
    multi.onRowPointerDown(id, event);
  }

  function onTitleKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (event.shiftKey) {
        event.preventDefault();
        multi.extendBy(event.key === 'ArrowUp' ? -1 : 1);
      }
    }
  }

  if (rows.length === 0) {
    return (
      <div className="plan-table-empty">
        <p>
          {filterActive
            ? 'No groups match the filter.'
            : 'No delivery plan yet. Add groups in the outline, then edit fields here.'}
        </p>
      </div>
    );
  }

  return (
    <div className="plan-table-wrap">
      <table className="plan-table">
        <thead>
          <tr>
            <th className="col-title">Group</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Resource</th>
            <th className="col-num">Points</th>
            <th className="col-num">Days</th>
            <th>Start</th>
            <th>Finish</th>
            <th className="col-keys">Keys</th>
            <th className="col-num">Deps</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const node = graph.nodes[row.id]!;
            const isAnchor = row.id === selectedId;
            const isMulti = multi.size > 1 && !isAnchor && multi.isSelected(row.id);
            const effort = rolledEffort(graph, row.id);
            const duration = rolledDuration(graph, row.id);
            const rowWaiting = waiting.get(row.id);
            const inCycle = cycles.has(row.id);
            // Locked groups freeze naming only — the title is read-only, but
            // status/estimate/dates/keys stay editable (plan meta is always
            // editable against a frozen skeleton).
            const locked = isLocked(row.depth, 'group', graph.settings, levels);
            return (
              <tr
                key={row.id}
                className={`plan-table-row${isAnchor ? ' row-selected' : ''}${
                  isMulti ? ' row-multiselected' : ''
                }${row.matched === false ? ' row-context' : row.matched ? ' row-match' : ''}`}
                onMouseDown={(e) => onRowMouseDown(row.id, e)}
              >
                <td
                  className={`col-title${locked ? ' cell-locked' : ''}`}
                  style={{ paddingLeft: `${row.depth * 16 + 8}px` }}
                >
                  {locked && (
                    <span className="row-lock" title="Locked — this level is frozen against edits">
                      🔒
                    </span>
                  )}
                  <input
                    className="cell-input cell-title"
                    value={node.title}
                    title={node.title || undefined}
                    placeholder="Untitled"
                    readOnly={locked}
                    onChange={(e) =>
                      store.commit((g) => updateNode(g, row.id, { title: e.target.value }), {
                        coalesce: `title:${row.id}`,
                      })
                    }
                    onFocus={() => onSelect(row.id)}
                    onKeyDown={onTitleKeyDown}
                    onBlur={() => store.breakCoalescing()}
                  />
                  {onReveal && (
                    <button
                      className="cell-reveal"
                      title="Open in the plan outline (details, dependencies)"
                      onClick={() => onReveal(row.id)}
                    >
                      ⤢
                    </button>
                  )}
                </td>
                <td>
                  <select
                    className={`cell-select status-select status-${node.status}`}
                    value={node.status}
                    onChange={(e) =>
                      bulkCommit(row.id, (g, t) =>
                        updateNode(g, t, { status: e.target.value as Status }),
                      )
                    }
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="cell-select"
                    value={node.priority}
                    onChange={(e) =>
                      bulkCommit(row.id, (g, t) =>
                        updateNode(g, t, { priority: e.target.value as Priority }),
                      )
                    }
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="cell-select"
                    value={node.resourceId ?? ''}
                    onChange={(e) =>
                      bulkCommit(row.id, (g, t) => assignResource(g, t, e.target.value || null))
                    }
                  >
                    <option value="">—</option>
                    {graph.settings.resources.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name.trim() || 'Unnamed'}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="col-num">
                  <input
                    className="cell-input cell-num"
                    type="number"
                    min="0"
                    step="0.5"
                    value={node.effort ?? ''}
                    placeholder={
                      effort.value !== null && !effort.fromOwn ? `${effort.value}` : '—'
                    }
                    onChange={(e) => {
                      const value = numberFor(e.target.value);
                      if (value === undefined) return;
                      bulkCommit(row.id, (g, t) => setEstimate(g, t, { effort: value }), `effort:${row.id}`);
                    }}
                    onBlur={() => store.breakCoalescing()}
                  />
                </td>
                <td className="col-num">
                  <input
                    className="cell-input cell-num"
                    type="number"
                    min="0"
                    step="0.5"
                    value={node.durationEstimate ?? ''}
                    placeholder={
                      duration.value !== null && !duration.fromOwn ? `${duration.value}` : '—'
                    }
                    onChange={(e) => {
                      const value = numberFor(e.target.value);
                      if (value === undefined) return;
                      bulkCommit(
                        row.id,
                        (g, t) => setEstimate(g, t, { durationEstimate: value }),
                        `duration:${row.id}`,
                      );
                    }}
                    onBlur={() => store.breakCoalescing()}
                  />
                </td>
                <td>
                  <input
                    className="cell-input cell-date"
                    type="date"
                    value={node.actualStart ?? ''}
                    onChange={(e) =>
                      bulkCommit(row.id, (g, t) =>
                        setActualDates(g, t, { actualStart: e.target.value || null }),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    className="cell-input cell-date"
                    type="date"
                    value={node.actualFinish ?? ''}
                    onChange={(e) =>
                      bulkCommit(row.id, (g, t) =>
                        setActualDates(g, t, { actualFinish: e.target.value || null }),
                      )
                    }
                  />
                </td>
                <td className="col-keys">
                  <KeyEditor id={row.id} compact />
                </td>
                <td className="col-num">
                  {inCycle && (
                    <span className="cell-badge cell-badge-cycle" title="In a dependency cycle">
                      ⟳
                    </span>
                  )}
                  {rowWaiting !== undefined ? (
                    <span
                      className="cell-badge"
                      title={
                        'Waiting on ' +
                        rowWaiting.map((w) => `“${graph.nodes[w]?.title ?? '?'}”`).join(', ')
                      }
                    >
                      ⧗ {rowWaiting.length}
                    </span>
                  ) : (
                    !inCycle && <span className="cell-muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
