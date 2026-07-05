/**
 * Keyboard-first outliner over one side of the 'contains' graph — the
 * spec tree (work nodes) or the delivery tree (group nodes). Enter =
 * sibling after, Tab/Shift+Tab = indent/outdent, Alt+Up/Down = reorder,
 * Cmd/Ctrl+. = fold, Backspace on an empty row or Cmd/Ctrl+Backspace =
 * delete (confirming before cascade deletes).
 *
 * Collapse state and selection are view state, not graph data, so they
 * live here and never enter the store or undo history. The planning
 * view augments rows with member chips and drop targets via rowExtras /
 * rowDropProps.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cycleIndexOf, waitingMap } from '../model/analysis.ts';
import {
  createGroup,
  createId,
  createNode,
  deleteNode,
  moveNode,
  subtreeIds,
  updateNode,
} from '../model/graph.ts';
import type { Status } from '../model/types.ts';
import { DependencyEditor } from './DependencyEditor.tsx';
import { store, useProjectGraph } from '../store/appStore.ts';
import {
  indentTarget,
  insertionPointAfter,
  outdentTarget,
  reorderTarget,
  visibleRows,
  type OutlineSide,
} from './outline.ts';
import { OutlinerRow, type RowActions, type RowDropProps } from './OutlinerRow.tsx';

interface OutlinerProps {
  side?: OutlineSide;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  emptyHint?: string;
  emptyButtonLabel?: string;
  addLabel?: string;
  /** Extra content rendered inside a row, after the title (chips, badges). */
  rowExtras?: (id: string) => ReactNode;
  /** Native DnD handlers to make a row a drop target. */
  rowDropProps?: (id: string) => RowDropProps | undefined;
}

export function Outliner({
  side = 'work',
  selectedId,
  onSelect,
  emptyHint = 'No spec yet.',
  emptyButtonLabel = 'Add the first item',
  addLabel = '+ Add item',
  rowExtras,
  rowDropProps,
}: OutlinerProps) {
  const graph = useProjectGraph();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // Things3-style: at most one row shows its details card.
  const [detailsId, setDetailsId] = useState<string | null>(null);
  // Bumped to re-run the focus effect when the DOM may have dropped focus
  // (row reorders) even though selectedId itself is unchanged.
  const [focusTick, setFocusTick] = useState(0);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());

  const rows = useMemo(
    () => visibleRows(graph, collapsed, side),
    [graph, collapsed, side],
  );

  // Dependency signals (work side only): who is waiting, who cycles.
  const depInfo = useMemo(
    () =>
      side === 'work'
        ? { waiting: waitingMap(graph), cycles: cycleIndexOf(graph) }
        : null,
    [graph, side],
  );

  // Moving the selection away closes the open details card.
  useEffect(() => {
    if (detailsId !== null && selectedId !== detailsId) {
      setDetailsId(null);
      store.breakCoalescing();
    }
  }, [selectedId, detailsId]);

  // So does clicking anywhere outside the card — not just on another
  // row. pointerdown (not click) so it fires before whatever was
  // clicked handles the event.
  useEffect(() => {
    if (detailsId === null) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.row-open')) return;
      setDetailsId(null);
      store.breakCoalescing();
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [detailsId]);

  useEffect(() => {
    if (selectedId === null) return;
    // The details textarea owns focus while its card is open (autoFocus).
    if (detailsId === selectedId) return;
    const el = inputRefs.current.get(selectedId);
    if (el && document.activeElement !== el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [selectedId, focusTick, detailsId]);

  function requestFocus(id: string) {
    onSelect(id);
    setFocusTick((t) => t + 1);
  }

  function expand(id: string) {
    if (!collapsed.has(id)) return;
    const next = new Set(collapsed);
    next.delete(id);
    setCollapsed(next);
  }

  function createEmpty(g: ReturnType<typeof store.getState>, id: string, parentId?: string) {
    return side === 'group'
      ? createGroup(g, { id, title: '' }, parentId)
      : createNode(g, { id, title: '' }, parentId);
  }

  function createAfter(afterId: string | null) {
    const newId = createId();
    store.commit((g) => {
      if (afterId === null) return createEmpty(g, newId);
      const { parentId, index } = insertionPointAfter(g, afterId);
      g = createEmpty(g, newId, parentId ?? undefined);
      return moveNode(g, newId, parentId, index);
    });
    requestFocus(newId);
  }

  function remove(id: string) {
    const current = store.getState();
    const node = current.nodes[id];
    if (!node) return;
    const count = subtreeIds(current, id).size;
    if (count > 1) {
      const label = node.title.trim() === '' ? 'this item' : `“${node.title}”`;
      const nested = `${count - 1} nested ${side === 'group' ? 'group' : 'item'}${
        count > 2 ? 's' : ''
      }`;
      const consequence =
        side === 'group'
          ? 'Their assignments are removed; work items stay in the spec.'
          : 'Dependencies and assignments of deleted items are removed too.';
      if (!window.confirm(`Delete ${label} and ${nested}? ${consequence}`)) return;
    }
    const index = rows.findIndex((r) => r.id === id);
    const next = store.commit((g) => deleteNode(g, id));
    const nextRows = visibleRows(next, collapsed, side);
    const target = nextRows[Math.min(Math.max(index - 1, 0), nextRows.length - 1)];
    if (target) requestFocus(target.id);
    else onSelect(null);
  }

  const actions: RowActions = {
    setTitle(id, title) {
      store.commit((g) => updateNode(g, id, { title }), { coalesce: `title:${id}` });
    },
    setDetails(id, details) {
      store.commit((g) => updateNode(g, id, { description: details }), {
        coalesce: `details:${id}`,
      });
    },
    toggleDetails(id) {
      // Opening or closing the card ends the current typing session, so
      // each visit to the details editor is its own undo step (the
      // textarea's blur handler does not fire when it unmounts).
      store.breakCoalescing();
      if (detailsId === id) {
        setDetailsId(null);
        requestFocus(id);
      } else {
        setDetailsId(id);
        onSelect(id);
      }
    },
    createAfter,
    // Targets are computed inside the commit callback, on the graph
    // actually being mutated — the rendered `graph` can lag a keystroke
    // behind when events arrive faster than React re-renders.
    indent(id) {
      let target: string | null = null;
      store.commit((g) => {
        target = indentTarget(g, id);
        return target === null ? g : moveNode(g, id, target);
      });
      if (target === null) return;
      expand(target);
      requestFocus(id);
    },
    outdent(id) {
      let moved = false;
      store.commit((g) => {
        const target = outdentTarget(g, id);
        if (target === null) return g;
        moved = true;
        return moveNode(g, id, target.parentId, target.index);
      });
      if (moved) requestFocus(id);
    },
    reorder(id, delta) {
      let moved = false;
      store.commit((g) => {
        const target = reorderTarget(g, id, delta);
        if (target === null) return g;
        moved = true;
        return moveNode(g, id, target.parentId, target.index);
      });
      if (moved) requestFocus(id);
    },
    remove,
    toggleCollapse(id) {
      const next = new Set(collapsed);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setCollapsed(next);
    },
    navigate(id, delta) {
      const index = rows.findIndex((r) => r.id === id);
      const target = rows[index + delta];
      if (target) requestFocus(target.id);
    },
    select(id) {
      onSelect(id);
    },
    endEditing() {
      store.breakCoalescing();
    },
  };

  const STATUS_CYCLE: Status[] = ['not_started', 'in_progress', 'done'];
  function cycleStatus(id: string) {
    store.commit((g) => {
      const current = g.nodes[id]?.status ?? 'not_started';
      const at = STATUS_CYCLE.indexOf(current);
      const next = STATUS_CYCLE[(at + 1) % STATUS_CYCLE.length]!;
      return updateNode(g, id, { status: next });
    });
  }

  function depBadges(id: string): ReactNode {
    if (depInfo === null) return null;
    const inCycle = depInfo.cycles.has(id);
    const waiting = depInfo.waiting.get(id);
    if (!inCycle && waiting === undefined) return null;
    return (
      <>
        {inCycle && (
          <span className="dep-badge dep-badge-cycle" title="Part of a dependency cycle">
            ⟳ cycle
          </span>
        )}
        {waiting !== undefined && (
          <span
            className="dep-badge"
            title={
              'Waiting on ' +
              waiting.map((w) => `“${graph.nodes[w]?.title ?? '?'}”`).join(', ')
            }
          >
            ⧗ {waiting.length}
          </span>
        )}
      </>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="outliner-empty">
        <p>{emptyHint}</p>
        <button className="button-primary" onClick={() => createAfter(null)}>
          {emptyButtonLabel}
        </button>
      </div>
    );
  }

  return (
    <div className="outliner">
      {rows.map((row) => (
        <OutlinerRow
          key={row.id}
          row={row}
          title={graph.nodes[row.id]?.title ?? ''}
          details={graph.nodes[row.id]?.description ?? ''}
          expanded={row.id === detailsId}
          childCount={row.collapsed ? subtreeIds(graph, row.id).size - 1 : 0}
          selected={row.id === selectedId}
          actions={actions}
          extras={
            <>
              {depBadges(row.id)}
              {rowExtras?.(row.id)}
            </>
          }
          dropProps={rowDropProps?.(row.id)}
          status={side === 'work' ? graph.nodes[row.id]?.status : undefined}
          onCycleStatus={side === 'work' ? cycleStatus : undefined}
          detailsExtras={side === 'work' ? <DependencyEditor id={row.id} /> : undefined}
          registerInput={(id, el) => {
            if (el) inputRefs.current.set(id, el);
            else inputRefs.current.delete(id);
          }}
        />
      ))}
      <button className="add-row" onClick={() => createAfter(null)}>
        {addLabel}
      </button>
    </div>
  );
}
