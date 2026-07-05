import type { DragEvent, KeyboardEvent, ReactNode } from 'react';
import type { Status } from '../model/types.ts';
import type { OutlineRow } from './outline.ts';

export interface RowDropProps {
  dropping: boolean;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}

export interface RowActions {
  setTitle: (id: string, title: string) => void;
  setDetails: (id: string, details: string) => void;
  toggleDetails: (id: string) => void;
  createAfter: (id: string) => void;
  indent: (id: string) => void;
  outdent: (id: string) => void;
  reorder: (id: string, delta: -1 | 1) => void;
  remove: (id: string) => void;
  toggleCollapse: (id: string) => void;
  navigate: (id: string, delta: -1 | 1) => void;
  select: (id: string) => void;
  endEditing: () => void;
}

interface OutlinerRowProps {
  row: OutlineRow;
  title: string;
  /** The node's details text (description field). */
  details: string;
  /** Whether the Things3-style details card is open for this row. */
  expanded: boolean;
  childCount: number;
  selected: boolean;
  actions: RowActions;
  registerInput: (id: string, el: HTMLInputElement | null) => void;
  /** Extra content after the title: member chips, badges. */
  extras?: ReactNode;
  /** Present when the row is a drop target (planning view). */
  dropProps?: RowDropProps;
  /** Work rows: current status; the bullet becomes a status control. */
  status?: Status;
  onCycleStatus?: (id: string) => void;
  /** Extra content inside the expanded details card (dependency editor). */
  detailsExtras?: ReactNode;
}

export function OutlinerRow({
  row,
  title,
  details,
  expanded,
  childCount,
  selected,
  actions,
  registerInput,
  extras,
  dropProps,
  status,
  onCycleStatus,
  detailsExtras,
}: OutlinerRowProps) {
  const { id } = row;

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === 'Enter' && mod) {
      event.preventDefault();
      actions.toggleDetails(id);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      actions.createAfter(id);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      if (event.shiftKey) actions.outdent(id);
      else actions.indent(id);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const delta = event.key === 'ArrowUp' ? -1 : 1;
      event.preventDefault();
      if (event.altKey) actions.reorder(id, delta);
      else actions.navigate(id, delta);
    } else if (event.key === 'Backspace' && (mod || title === '')) {
      event.preventDefault();
      actions.remove(id);
    } else if (event.key === '.' && mod) {
      event.preventDefault();
      actions.toggleCollapse(id);
    } else if (event.key === 'Escape') {
      event.currentTarget.blur();
    }
  }

  const dropClass = dropProps?.dropping ? ' row-drop' : '';
  const openClass = expanded ? ' row-open' : '';
  return (
    <div
      className={`row${selected ? ' row-selected' : ''}${dropClass}${openClass}`}
      style={{ paddingLeft: `${row.depth * 22 + 8}px` }}
      onDragOver={dropProps?.onDragOver}
      onDragLeave={dropProps?.onDragLeave}
      onDrop={dropProps?.onDrop}
    >
      {row.hasChildren ? (
        <button
          className={`chevron${row.collapsed ? ' chevron-closed' : ''}`}
          aria-label={row.collapsed ? 'Expand' : 'Collapse'}
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => actions.toggleCollapse(id)}
        >
          ▾
        </button>
      ) : (
        <span className="chevron chevron-spacer" />
      )}
      {onCycleStatus !== undefined && status !== undefined ? (
        <button
          className={`bullet bullet-status status-${status}${
            row.hasChildren ? ' bullet-parent' : ''
          }`}
          title={`Status: ${status.replace('_', ' ')} — click to change`}
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onCycleStatus(id)}
        />
      ) : (
        <span className={`bullet${row.hasChildren ? ' bullet-parent' : ''}`} />
      )}
      <input
        ref={(el) => registerInput(id, el)}
        className={`row-input${status === 'done' ? ' row-input-done' : ''}`}
        value={title}
        placeholder="Untitled"
        onChange={(e) => actions.setTitle(id, e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => actions.select(id)}
        onBlur={() => actions.endEditing()}
      />
      {!expanded && (
        <button
          className={`details-indicator${
            details.trim() === '' ? ' details-indicator-empty' : ''
          }`}
          title={details.trim() === '' ? 'Add details (⌘↩)' : 'Show details (⌘↩)'}
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => actions.toggleDetails(id)}
        >
          ≡
        </button>
      )}
      {row.collapsed && <span className="row-count">{childCount}</span>}
      {extras}
      {expanded && (
        <>
          <textarea
            className="row-details"
            value={details}
            placeholder="Details…"
            autoFocus
            onChange={(e) => actions.setDetails(id, e.target.value)}
            onBlur={() => actions.endEditing()}
            onKeyDown={(e) => {
              if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
                e.preventDefault();
                actions.toggleDetails(id);
              }
            }}
          />
          {detailsExtras}
        </>
      )}
    </div>
  );
}
