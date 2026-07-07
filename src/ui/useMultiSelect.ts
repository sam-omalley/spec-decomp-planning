/**
 * Multi-row selection shared by the outliner and the plan table. The
 * cross-view anchor stays in App's single `selectedId` (so graph /
 * timeline / planning sync and selection healing are unchanged); this
 * hook layers a set of *extra* rows on top for range and toggle
 * selection over an ordered list of ids.
 *
 * Effective selection = the anchor (when set) plus the extras. Plain
 * clicks and keyboard navigation collapse back to just the anchor by
 * calling `clear`; ⇧-click / ⇧-Arrow extend a contiguous range from the
 * anchor; ⌘/Ctrl-click toggles a single row.
 */

import { useCallback, useMemo, useState } from 'react';

export interface RowPointerModifiers {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  preventDefault: () => void;
}

export interface MultiSelect {
  /** Full effective selection, always including the anchor when set. */
  selected: ReadonlySet<string>;
  isSelected: (id: string) => boolean;
  size: number;
  /** Mouse-down on a row: plain = single, ⇧ = range, ⌘/Ctrl = toggle. */
  onRowPointerDown: (id: string, event: RowPointerModifiers) => void;
  /** ⇧+Arrow: grow/shrink the range from the anchor by one row. */
  extendBy: (delta: -1 | 1) => void;
  /** Collapse back to just the anchor (plain click / navigation). */
  clear: () => void;
}

export function useMultiSelect(
  orderedIds: string[],
  anchorId: string | null,
  onSelectAnchor: (id: string) => void,
): MultiSelect {
  // Ids selected beyond the anchor, and the moving endpoint of the last
  // range so ⇧+Arrow can extend it.
  const [extra, setExtra] = useState<ReadonlySet<string>>(new Set());
  const [lead, setLead] = useState<string | null>(null);

  const selected = useMemo(() => {
    const set = new Set(extra);
    if (anchorId !== null) set.add(anchorId);
    return set;
  }, [extra, anchorId]);

  const clear = useCallback(() => {
    setExtra((prev) => (prev.size === 0 ? prev : new Set()));
    setLead(null);
  }, []);

  const selectRange = useCallback(
    (from: string, to: string) => {
      const i = orderedIds.indexOf(from);
      const j = orderedIds.indexOf(to);
      if (i === -1 || j === -1) return;
      const [lo, hi] = i <= j ? [i, j] : [j, i];
      const next = new Set(orderedIds.slice(lo, hi + 1));
      next.delete(from); // the anchor lives in `selected` separately
      setExtra(next);
      setLead(to);
    },
    [orderedIds],
  );

  const onRowPointerDown = useCallback(
    (id: string, event: RowPointerModifiers) => {
      if (event.shiftKey) {
        event.preventDefault();
        if (anchorId === null) {
          onSelectAnchor(id);
          setExtra(new Set());
          setLead(id);
        } else {
          selectRange(anchorId, id);
        }
      } else if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        if (id === anchorId) return; // toggling the anchor off is a no-op
        setExtra((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        setLead(id);
      } else {
        onSelectAnchor(id);
        clear();
      }
    },
    [anchorId, onSelectAnchor, selectRange, clear],
  );

  const extendBy = useCallback(
    (delta: -1 | 1) => {
      if (anchorId === null) return;
      const base = lead ?? anchorId;
      const idx = orderedIds.indexOf(base) + delta;
      if (idx < 0 || idx >= orderedIds.length) return;
      selectRange(anchorId, orderedIds[idx]!);
    },
    [anchorId, lead, orderedIds, selectRange],
  );

  return {
    selected,
    isSelected: (id) => selected.has(id),
    size: selected.size,
    onRowPointerDown,
    extendBy,
    clear,
  };
}
