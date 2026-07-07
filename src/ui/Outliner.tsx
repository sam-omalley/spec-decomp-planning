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
import { rolledDuration, rolledEffort } from '../model/rollup.ts';
import type { Status } from '../model/types.ts';
import { DependencyEditor } from './DependencyEditor.tsx';
import { NodeMetaEditor } from './NodeMetaEditor.tsx';
import { store, useProjectGraph } from '../store/appStore.ts';
import { EMPTY_FILTER, isFilterActive, matchesFilter, type FilterState } from './filter.ts';
import {
  contiguousSiblingRange,
  indentTarget,
  insertionPointAfter,
  insertionPointBefore,
  insertionPointForEnter,
  outdentTarget,
  parseOutlineText,
  reorderTarget,
  siblingsOf,
  visibleRows,
  type OutlineSide,
} from './outline.ts';
import { OutlinerRow, type RowActions, type RowDropProps } from './OutlinerRow.tsx';
import { useMultiSelect } from './useMultiSelect.ts';

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
  /** Global filter; when active, rows narrow to matches + ancestor context. */
  filter?: FilterState;
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
  filter = EMPTY_FILTER,
}: OutlinerProps) {
  const graph = useProjectGraph();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // Things3-style: at most one row shows its details card.
  const [detailsId, setDetailsId] = useState<string | null>(null);
  // Bumped to re-run the focus effect when the DOM may have dropped focus
  // (row reorders) even though selectedId itself is unchanged.
  const [focusTick, setFocusTick] = useState(0);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());

  const filterActive = isFilterActive(filter);
  const rows = useMemo(
    () =>
      visibleRows(
        graph,
        collapsed,
        side,
        filterActive ? (id) => matchesFilter(graph.nodes[id]!, filter) : undefined,
      ),
    [graph, collapsed, side, filterActive, filter],
  );

  // Multi-select layered over App's single-selection anchor: ⇧/⌘ click,
  // ⇧+Arrow. Structural ops (indent/outdent/reorder/delete) fan out to
  // the whole selection when it forms a clean contiguous sibling range.
  const orderedIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const multi = useMultiSelect(orderedIds, selectedId, onSelect);

  // Dependency signals (work side only): who is waiting, who cycles.
  const depInfo = useMemo(
    () =>
      side === 'group'
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
      // Land on the next visible line at the cursor — an expanded
      // parent gets a first child, not a sibling after its subtree.
      const { parentId, index } = insertionPointForEnter(g, afterId, collapsed);
      g = createEmpty(g, newId, parentId ?? undefined);
      return moveNode(g, newId, parentId, index);
    });
    multi.clear();
    requestFocus(newId);
  }

  function createBefore(beforeId: string) {
    const newId = createId();
    store.commit((g) => {
      const { parentId, index } = insertionPointBefore(g, beforeId);
      g = createEmpty(g, newId, parentId ?? undefined);
      return moveNode(g, newId, parentId, index);
    });
    multi.clear();
    requestFocus(newId);
  }

  // Turn pasted multi-line text into rows in one undo step, inferring
  // nesting from indentation. The first line fills the pasted-on row when
  // it is empty; otherwise every line inserts after it.
  function pasteRows(anchorId: string, text: string) {
    const parsed = parseOutlineText(text);
    if (parsed.length === 0) return;
    const ids = parsed.map(() => createId());
    store.commit((g) => {
      let next = g;
      const anchor = next.nodes[anchorId];
      const anchorEmpty = anchor !== undefined && anchor.title.trim() === '';
      const base = insertionPointAfter(next, anchorId);
      // parentAtDepth[d] = the id nodes at depth d+1 nest under.
      const parentAtDepth: (string | null)[] = [];
      let rootOffset = 0; // depth-0 siblings created after the anchor
      parsed.forEach((line, i) => {
        if (i === 0 && anchorEmpty && line.depth === 0) {
          next = updateNode(next, anchorId, { title: line.title });
          ids[i] = anchorId; // reuse the row for focus + nesting
          parentAtDepth.length = 1;
          parentAtDepth[0] = anchorId;
          return;
        }
        const id = ids[i]!;
        const parentId =
          line.depth === 0 ? base.parentId : parentAtDepth[line.depth - 1] ?? base.parentId;
        next = createEmpty(next, id, parentId ?? undefined);
        next = updateNode(next, id, { title: line.title });
        if (line.depth === 0) {
          next = moveNode(next, id, base.parentId, base.index + rootOffset);
          rootOffset++;
        }
        parentAtDepth.length = line.depth + 1;
        parentAtDepth[line.depth] = id;
      });
      return next;
    });
    multi.clear();
    requestFocus(ids[ids.length - 1]!);
  }

  function remove(id: string) {
    const current = store.getState();
    const node = current.nodes[id];
    if (!node) return;
    // Delete the whole selection when it includes this row; else just it.
    const targets = (
      multi.size > 1 && multi.selected.has(id) ? [...multi.selected] : [id]
    ).filter((x) => current.nodes[x]);
    if (targets.length === 0) return;
    const consequence =
      side === 'group'
        ? 'Their assignments are removed; work items stay in the spec.'
        : 'Dependencies and assignments of deleted items are removed too.';
    const removed = new Set<string>();
    for (const t of targets) for (const s of subtreeIds(current, t)) removed.add(s);
    const nested = removed.size - targets.length;
    if (targets.length > 1 || nested > 0) {
      const label =
        targets.length > 1
          ? `${targets.length} ${side === 'group' ? 'groups' : 'items'}`
          : node.title.trim() === ''
            ? 'this item'
            : `“${node.title}”`;
      const withNested = nested > 0 ? ` and ${nested} nested` : '';
      if (!window.confirm(`Delete ${label}${withNested}? ${consequence}`)) return;
    }
    const index = rows.findIndex((r) => r.id === id);
    const next = store.commit((g) => {
      let n = g;
      for (const t of targets) if (n.nodes[t]) n = deleteNode(n, t);
      return n;
    });
    multi.clear();
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
    createBefore,
    pasteRows,
    onRowPointerDown: multi.onRowPointerDown,
    extendSelection: multi.extendBy,
    // The selection fans structural ops out when it forms a clean
    // contiguous sibling run; otherwise each op falls back to the single
    // anchor row. Targets are computed inside the commit callback, on the
    // graph actually being mutated — the rendered `graph` can lag a
    // keystroke behind when events arrive faster than React re-renders.
    indent(id) {
      const groupIds = multi.size > 1 && multi.selected.has(id) ? [...multi.selected] : null;
      let target: string | null = null;
      store.commit((g) => {
        if (groupIds) {
          const range = contiguousSiblingRange(g, groupIds);
          if (range && range.ids.length > 1) {
            const t = indentTarget(g, range.ids[0]!);
            if (t === null) return g;
            let next = g;
            for (const rid of range.ids) next = moveNode(next, rid, t);
            target = t;
            return next;
          }
        }
        target = indentTarget(g, id);
        return target === null ? g : moveNode(g, id, target);
      });
      if (target === null) return;
      expand(target);
      requestFocus(id);
    },
    outdent(id) {
      const groupIds = multi.size > 1 && multi.selected.has(id) ? [...multi.selected] : null;
      let moved = false;
      store.commit((g) => {
        if (groupIds) {
          const range = contiguousSiblingRange(g, groupIds);
          if (range && range.ids.length > 1) {
            const t = outdentTarget(g, range.ids[0]!);
            if (t === null) return g;
            let next = g;
            range.ids.forEach((rid, k) => {
              next = moveNode(next, rid, t.parentId, t.index + k);
            });
            moved = true;
            return next;
          }
        }
        const target = outdentTarget(g, id);
        if (target === null) return g;
        moved = true;
        return moveNode(g, id, target.parentId, target.index);
      });
      if (moved) requestFocus(id);
    },
    reorder(id, delta) {
      const groupIds = multi.size > 1 && multi.selected.has(id) ? [...multi.selected] : null;
      let moved = false;
      store.commit((g) => {
        if (groupIds) {
          const range = contiguousSiblingRange(g, groupIds);
          if (range && range.ids.length > 1) {
            // Move the block by one by hopping the single neighbour to
            // the far side, which shifts every selected row together.
            const siblings = siblingsOf(g, range.ids[0]!);
            const firstPos = siblings.indexOf(range.ids[0]!);
            const lastPos = siblings.indexOf(range.ids[range.ids.length - 1]!);
            if (delta === -1 && firstPos > 0) {
              moved = true;
              return moveNode(g, siblings[firstPos - 1]!, range.parentId, lastPos);
            }
            if (delta === 1 && lastPos < siblings.length - 1) {
              moved = true;
              return moveNode(g, siblings[lastPos + 1]!, range.parentId, firstPos);
            }
            return g;
          }
        }
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
      if (target) {
        multi.clear();
        requestFocus(target.id);
      }
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

  // A compact rolled estimate chip (work side): own estimate wins over
  // the sum of descendants; a ⚠ marks a subtree with unestimated leaves.
  function estimateChip(id: string): ReactNode {
    if (side !== 'group') return null;
    const days = rolledDuration(graph, id);
    const points = rolledEffort(graph, id);
    if (days.value === null && points.value === null && !days.hasGaps) return null;
    const parts: string[] = [];
    if (days.value !== null) parts.push(`${days.value}d`);
    if (points.value !== null) parts.push(`${points.value}pt`);
    if (parts.length === 0) return null;
    const gaps = days.hasGaps || points.hasGaps;
    return (
      <span
        className={`est-chip${gaps ? ' est-chip-gaps' : ''}`}
        title={
          (days.fromOwn ? 'Own estimate' : 'Rolled up from sub-items') +
          (gaps ? ' · some sub-items are unestimated' : '')
        }
      >
        {parts.join(' · ')}
        {gaps && ' ⚠'}
      </span>
    );
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
          multiSelected={multi.size > 1 && row.id !== selectedId && multi.isSelected(row.id)}
          actions={actions}
          extras={
            <>
              {estimateChip(row.id)}
              {depBadges(row.id)}
              {rowExtras?.(row.id)}
            </>
          }
          dropProps={rowDropProps?.(row.id)}
          status={side === 'group' ? graph.nodes[row.id]?.status : undefined}
          onCycleStatus={side === 'group' ? cycleStatus : undefined}
          detailsExtras={
            side === 'group' ? (
              <>
                <NodeMetaEditor id={row.id} />
                <DependencyEditor id={row.id} />
              </>
            ) : undefined
          }
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
