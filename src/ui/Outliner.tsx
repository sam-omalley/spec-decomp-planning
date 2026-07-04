/**
 * Keyboard-first outliner over the 'contains' forest — the primary
 * editing surface. Enter = sibling after, Tab/Shift+Tab = indent/outdent,
 * Alt+Up/Down = reorder, Cmd/Ctrl+. = fold, Backspace on an empty row or
 * Cmd/Ctrl+Backspace = delete (confirming before cascade deletes).
 *
 * Collapse state and selection are view state, not graph data, so they
 * live here and never enter the store or undo history.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createId,
  createNode,
  deleteNode,
  moveNode,
  subtreeIds,
  updateNode,
} from '../model/graph.ts';
import { store, useProjectGraph } from '../store/appStore.ts';
import {
  indentTarget,
  insertionPointAfter,
  outdentTarget,
  reorderTarget,
  visibleRows,
} from './outline.ts';
import { OutlinerRow, type RowActions } from './OutlinerRow.tsx';

export function Outliner() {
  const graph = useProjectGraph();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Bumped to re-run the focus effect when the DOM may have dropped focus
  // (row reorders) even though selectedId itself is unchanged.
  const [focusTick, setFocusTick] = useState(0);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());

  const rows = useMemo(() => visibleRows(graph, collapsed), [graph, collapsed]);

  useEffect(() => {
    if (selectedId === null) return;
    const el = inputRefs.current.get(selectedId);
    if (el && document.activeElement !== el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [selectedId, focusTick]);

  function requestFocus(id: string) {
    setSelectedId(id);
    setFocusTick((t) => t + 1);
  }

  function expand(id: string) {
    if (!collapsed.has(id)) return;
    const next = new Set(collapsed);
    next.delete(id);
    setCollapsed(next);
  }

  function createAfter(afterId: string | null) {
    const newId = createId();
    store.commit((g) => {
      if (afterId === null) return createNode(g, { id: newId, title: '' });
      const { parentId, index } = insertionPointAfter(g, afterId);
      g = createNode(g, { id: newId, title: '' }, parentId ?? undefined);
      return parentId === null ? g : moveNode(g, newId, parentId, index);
    });
    requestFocus(newId);
  }

  function remove(id: string) {
    const node = graph.nodes[id];
    if (!node) return;
    const count = subtreeIds(graph, id).size;
    if (count > 1) {
      const label = node.title.trim() === '' ? 'this item' : `“${node.title}”`;
      const ok = window.confirm(
        `Delete ${label} and ${count - 1} nested item${count > 2 ? 's' : ''}? ` +
          'Dependencies and epic assignments of deleted items are removed too.',
      );
      if (!ok) return;
    }
    const index = rows.findIndex((r) => r.id === id);
    const next = store.commit((g) => deleteNode(g, id));
    const nextRows = visibleRows(next, collapsed);
    const target = nextRows[Math.min(Math.max(index - 1, 0), nextRows.length - 1)];
    if (target) requestFocus(target.id);
    else setSelectedId(null);
  }

  const actions: RowActions = {
    setTitle(id, title) {
      store.commit((g) => updateNode(g, id, { title }), { coalesce: `title:${id}` });
    },
    createAfter,
    indent(id) {
      const target = indentTarget(graph, id);
      if (target === null) return;
      store.commit((g) => moveNode(g, id, target));
      expand(target);
      requestFocus(id);
    },
    outdent(id) {
      const target = outdentTarget(graph, id);
      if (target === null) return;
      store.commit((g) => moveNode(g, id, target.parentId, target.index));
      requestFocus(id);
    },
    reorder(id, delta) {
      const target = reorderTarget(graph, id, delta);
      if (target === null) return;
      store.commit((g) => moveNode(g, id, target.parentId, target.index));
      requestFocus(id);
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
      setSelectedId(id);
    },
    endEditing() {
      store.breakCoalescing();
    },
  };

  if (rows.length === 0) {
    return (
      <div className="outliner-empty">
        <p>No spec yet.</p>
        <button className="button-primary" onClick={() => createAfter(null)}>
          Add the first item
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
          childCount={row.collapsed ? subtreeIds(graph, row.id).size - 1 : 0}
          selected={row.id === selectedId}
          actions={actions}
          registerInput={(id, el) => {
            if (el) inputRefs.current.set(id, el);
            else inputRefs.current.delete(id);
          }}
        />
      ))}
      <button className="add-row" onClick={() => createAfter(null)}>
        + Add item
      </button>
    </div>
  );
}
