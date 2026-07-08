import type { ClipboardEvent, DragEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { Status } from '../model/types.ts';
import type { OutlineRow } from './outline.ts';
import type { RowPointerModifiers } from './useMultiSelect.ts';

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
  createBefore: (id: string) => void;
  indent: (id: string) => void;
  outdent: (id: string) => void;
  reorder: (id: string, delta: -1 | 1) => void;
  remove: (id: string) => void;
  toggleCollapse: (id: string) => void;
  navigate: (id: string, delta: -1 | 1) => void;
  select: (id: string) => void;
  endEditing: () => void;
  /** Create rows from pasted multi-line text (indent-aware). */
  pasteRows: (id: string, text: string) => void;
  /** ⇧-click / ⇧-Arrow / ⌘-click selection over the visible rows. */
  onRowPointerDown: (id: string, event: RowPointerModifiers) => void;
  extendSelection: (delta: -1 | 1) => void;
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
  /** Part of a multi-selection but not the focused anchor row. */
  multiSelected?: boolean;
  /**
   * Row sits in a frozen top level: title/details are read-only and the
   * structural keys (Enter, Tab, Alt+Arrow, Backspace, paste) are inert.
   * Navigation, folding, and opening the details card stay live.
   */
  locked?: boolean;
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
  multiSelected,
  locked = false,
}: OutlinerRowProps) {
  const { id } = row;

  function onMouseDown(event: MouseEvent<HTMLInputElement>) {
    // Plain click collapses any multi-selection to this row; ⇧/⌘/Ctrl
    // clicks extend it and preventDefault so focus stays on the anchor.
    actions.onRowPointerDown(id, event);
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    if (locked) return;
    const text = event.clipboardData.getData('text/plain');
    // Only intercept genuine multi-line pastes; single lines paste normally.
    if (/\r|\n/.test(text.trimEnd())) {
      event.preventDefault();
      actions.pasteRows(id, text);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const mod = event.metaKey || event.ctrlKey;
    // A frozen row still navigates, folds, and opens its details card, but
    // the shape/naming keys are inert. readOnly already blocks typing.
    if (locked) {
      if (event.key === 'Enter' && mod) {
        event.preventDefault();
        actions.toggleDetails(id);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const delta = event.key === 'ArrowUp' ? -1 : 1;
        event.preventDefault();
        if (event.altKey) return; // reorder blocked
        if (event.shiftKey) actions.extendSelection(delta);
        else actions.navigate(id, delta);
      } else if (event.key === 'Backspace' && (mod || title === '')) {
        event.preventDefault(); // delete blocked
      } else if (event.key === '.' && mod) {
        event.preventDefault();
        actions.toggleCollapse(id);
      } else if (event.key === 'Escape') {
        event.currentTarget.blur();
      }
      return;
    }
    if (event.key === 'Enter' && mod) {
      event.preventDefault();
      actions.toggleDetails(id);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      // Shift+Enter, or Enter with the caret at the very start of a
      // non-empty title, inserts a row before this one.
      const input = event.currentTarget;
      const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
      if (event.shiftKey || (atStart && title !== '')) actions.createBefore(id);
      else actions.createAfter(id);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      if (event.shiftKey) actions.outdent(id);
      else actions.indent(id);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const delta = event.key === 'ArrowUp' ? -1 : 1;
      event.preventDefault();
      if (event.altKey) actions.reorder(id, delta);
      else if (event.shiftKey) actions.extendSelection(delta);
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
  const multiClass = multiSelected ? ' row-multiselected' : '';
  const lockClass = locked ? ' row-locked' : '';
  // While a filter is active, `row.matched` is set: false = ancestor
  // shown only as context (dimmed), true = an actual match (highlight).
  const filterClass =
    row.matched === false ? ' row-context' : row.matched ? ' row-match' : '';
  return (
    <div
      className={`row${selected ? ' row-selected' : ''}${multiClass}${dropClass}${openClass}${filterClass}${lockClass}`}
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
        readOnly={locked}
        onChange={(e) => actions.setTitle(id, e.target.value)}
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
        onPaste={onPaste}
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
      {locked && (
        <span className="row-lock" title="Locked — this level is frozen against edits">
          🔒
        </span>
      )}
      {extras}
      {expanded && (
        <>
          <textarea
            className="row-details"
            value={details}
            placeholder="Details…"
            autoFocus
            readOnly={locked}
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
