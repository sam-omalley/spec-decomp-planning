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
import { setActualDates, setEstimate, updateNode } from '../model/graph.ts';
import { rolledDuration, rolledEffort } from '../model/rollup.ts';
import type { Priority, ProjectGraph, Status } from '../model/types.ts';
import { store, useProjectGraph } from '../store/appStore.ts';
import { visibleRows } from './outline.ts';
import { useMultiSelect } from './useMultiSelect.ts';

const STATUSES: Status[] = ['not_started', 'in_progress', 'blocked', 'done'];
const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'critical'];
const NO_COLLAPSE: ReadonlySet<string> = new Set();

interface PlanTableProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function PlanTable({ selectedId, onSelect }: PlanTableProps) {
  const graph = useProjectGraph();
  const rows = useMemo(() => visibleRows(graph, NO_COLLAPSE, 'group'), [graph]);
  const orderedIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const multi = useMultiSelect(orderedIds, selectedId, onSelect);
  const waiting = useMemo(() => waitingMap(graph), [graph]);
  const cycles = useMemo(() => cycleIndexOf(graph), [graph]);

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
    // Only intercept modified clicks so plain clicks on inputs/selects
    // still edit; the hook preventDefaults ⇧/⌘ to preserve focus.
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      multi.onRowPointerDown(id, event);
    }
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
        <p>No delivery plan yet. Add groups in the outline, then edit fields here.</p>
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
            <th className="col-num">Points</th>
            <th className="col-num">Days</th>
            <th>Start</th>
            <th>Finish</th>
            <th className="col-num">Keys</th>
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
            return (
              <tr
                key={row.id}
                className={`plan-table-row${isAnchor ? ' row-selected' : ''}${
                  isMulti ? ' row-multiselected' : ''
                }`}
                onMouseDown={(e) => onRowMouseDown(row.id, e)}
              >
                <td className="col-title" style={{ paddingLeft: `${row.depth * 16 + 8}px` }}>
                  <input
                    className="cell-input cell-title"
                    value={node.title}
                    placeholder="Untitled"
                    onChange={(e) =>
                      store.commit((g) => updateNode(g, row.id, { title: e.target.value }), {
                        coalesce: `title:${row.id}`,
                      })
                    }
                    onFocus={() => onSelect(row.id)}
                    onKeyDown={onTitleKeyDown}
                    onBlur={() => store.breakCoalescing()}
                  />
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
                <td className="col-num">
                  {node.externalRefs.length > 0 ? (
                    <span
                      className="cell-count"
                      title={node.externalRefs
                        .map((r) => `${r.system} ${r.key}`)
                        .join('\n')}
                    >
                      {node.externalRefs.length}
                    </span>
                  ) : (
                    <span className="cell-muted">—</span>
                  )}
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
