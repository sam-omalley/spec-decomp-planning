/**
 * Disclosed facet picker for the global filter (issue #129): status,
 * priority, and tag multi-selects that sit next to the text search in the
 * header. The `FilterState` facets (`src/ui/filter.ts`) have been wired
 * into every consuming view since slice 1 was cut over to it — this is the
 * one UI surface that was missing. Kept ephemeral like the text search: it
 * never touches the graph, undo, or the URL hash.
 */

import { useEffect, useRef, useState } from 'react';
import type { Priority, Status } from '../model/types.ts';

const STATUSES: Status[] = ['not_started', 'in_progress', 'blocked', 'done'];
const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'critical'];

export interface FacetValue {
  statuses: Status[];
  priorities: Priority[];
  tags: string[];
}

interface FilterFacetsProps {
  value: FacetValue;
  onChange: (next: FacetValue) => void;
  /** Status is plan-only (CLAUDE.md: it's never surfaced on the spec side). */
  showStatus: boolean;
  /** Every tag currently in use on the graph, for the tag checklist. */
  tagOptions: string[];
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function FilterFacets({ value, onChange, showStatus, tagOptions }: FilterFacetsProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeCount = value.statuses.length + value.priorities.length + value.tags.length;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="filter-facets" ref={ref}>
      <button
        className="filter-facets-trigger header-btn-icon"
        aria-expanded={open}
        aria-label="Filters"
        title="Filter by status, priority, or tag"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M1 2h14l-5 6v4l-4 2v-6z" fill="currentColor" />
        </svg>
        {activeCount > 0 && <span className="filter-facets-count">{activeCount}</span>}
      </button>
      {open && (
        <div className="filter-facets-panel" role="group" aria-label="Filter facets">
          {showStatus && (
            <fieldset className="filter-facets-group">
              <legend>Status</legend>
              {STATUSES.map((s) => (
                <label key={s} className="filter-facets-option">
                  <input
                    type="checkbox"
                    checked={value.statuses.includes(s)}
                    onChange={() => onChange({ ...value, statuses: toggle(value.statuses, s) })}
                  />
                  {s.replace('_', ' ')}
                </label>
              ))}
            </fieldset>
          )}
          <fieldset className="filter-facets-group">
            <legend>Priority</legend>
            {PRIORITIES.map((p) => (
              <label key={p} className="filter-facets-option">
                <input
                  type="checkbox"
                  checked={value.priorities.includes(p)}
                  onChange={() => onChange({ ...value, priorities: toggle(value.priorities, p) })}
                />
                {p}
              </label>
            ))}
          </fieldset>
          {tagOptions.length > 0 && (
            <fieldset className="filter-facets-group">
              <legend>Tags</legend>
              {tagOptions.map((tag) => (
                <label key={tag} className="filter-facets-option">
                  <input
                    type="checkbox"
                    checked={value.tags.includes(tag)}
                    onChange={() => onChange({ ...value, tags: toggle(value.tags, tag) })}
                  />
                  {tag}
                </label>
              ))}
            </fieldset>
          )}
          {activeCount > 0 && (
            <button
              className="filter-facets-clear"
              onClick={() => onChange({ statuses: [], priorities: [], tags: [] })}
            >
              Clear facets
            </button>
          )}
        </div>
      )}
    </div>
  );
}
