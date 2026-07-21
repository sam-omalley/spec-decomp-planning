/**
 * Keyboard-first "assign to group" picker (#130): a filterable, arrow-key
 * navigable list of every group, opened by the `a` shortcut when one or
 * more spec rows are selected in Planning's Outline. Mirrors the shape of
 * the existing drag-and-drop assignment (`assignToGroup`) without needing
 * a pointer.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ProjectGraph } from '../model/types.ts';
import { visibleRows } from './outline.ts';

const NO_COLLAPSE: ReadonlySet<string> = new Set();

interface GroupPickerProps {
  graph: ProjectGraph;
  /** How many spec items this will assign, for the header hint. */
  count: number;
  onChoose: (groupId: string) => void;
  onClose: () => void;
}

export function GroupPicker({ graph, count, onChoose, onClose }: GroupPickerProps) {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const allGroups = useMemo(
    () =>
      visibleRows(graph, NO_COLLAPSE, 'group').map((row) => ({
        id: row.id,
        depth: row.depth,
        title: graph.nodes[row.id]?.title.trim() || 'Untitled',
      })),
    [graph],
  );

  const needle = query.trim().toLowerCase();
  const matches =
    needle === '' ? allGroups : allGroups.filter((g) => g.title.toLowerCase().includes(needle));

  useEffect(() => setHighlight(0), [query]);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    function onDocKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onDocKeyDown);
    return () => document.removeEventListener('keydown', onDocKeyDown);
  }, [onClose]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const picked = matches[highlight];
      if (picked) onChoose(picked.id);
    }
    // Escape is handled by the document listener above so it also closes
    // when focus isn't in the input (shouldn't happen, but cheap safety).
  }

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div
        className="picker-card"
        role="dialog"
        aria-label="Assign to group"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="picker-header">
          Assign {count} item{count === 1 ? '' : 's'} to…
        </div>
        <input
          ref={inputRef}
          className="picker-input"
          placeholder="Filter groups…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="picker-list" role="listbox" aria-label="Groups">
          {allGroups.length === 0 && <p className="picker-empty">No groups yet.</p>}
          {allGroups.length > 0 && matches.length === 0 && (
            <p className="picker-empty">No groups match.</p>
          )}
          {matches.map((g, i) => (
            <button
              key={g.id}
              type="button"
              role="option"
              aria-selected={i === highlight}
              className={`picker-option${i === highlight ? ' picker-option-active' : ''}`}
              style={{ paddingLeft: `${g.depth * 14 + 10}px` }}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChoose(g.id)}
            >
              {i === highlight ? '› ' : ''}
              {g.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
