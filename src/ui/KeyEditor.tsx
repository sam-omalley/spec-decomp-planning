/**
 * Compact editor for a node's external-tracker refs, reduced to the one
 * case that matters in practice: a Jira-style key. Existing refs render as
 * chips (keeping any `url` link and non-`jira` `system` label carried by
 * imported data). Most nodes carry zero or one key, so the entry input
 * stays collapsed behind a small `+` button rather than sitting open on
 * every row — clicking `+` (or the row already having a key still shows
 * it, for adding a second) reveals a focused input; Enter or clicking
 * away commits it and collapses back down. Escape cancels without
 * committing. The `ExternalRef` model (system/key/url) is unchanged —
 * this UI just narrows entry to key-only, leaving room to grow.
 *
 * A typed-but-unsubmitted key also commits when focus leaves the editor
 * entirely (#125) — every other meta field saves as you go, so requiring
 * the explicit + click was the one place data silently vanished if you
 * moved on without noticing.
 *
 * Shared by the group details card (`NodeMetaEditor`) and the plan table's
 * Keys cell; `compact` tightens it for the table.
 */

import { useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import { addExternalRef, removeExternalRef } from '../model/graph.ts';
import { store, useProjectGraph } from '../store/appStore.ts';

const DEFAULT_SYSTEM = 'jira';

interface KeyEditorProps {
  id: string;
  /** Tighter layout for dense contexts (the plan table cell). */
  compact?: boolean;
}

export function KeyEditor({ id, compact }: KeyEditorProps) {
  const graph = useProjectGraph();
  const node = graph.nodes[id];
  const [key, setKey] = useState('');
  const [adding, setAdding] = useState(false);
  if (!node) return null;

  const trimmed = key.trim();
  const exists = node.externalRefs.some(
    (r) => r.system === DEFAULT_SYSTEM && r.key === trimmed,
  );
  const canAdd = trimmed !== '' && !exists;

  function addKey() {
    if (!canAdd) return;
    store.commit((g) => addExternalRef(g, id, { system: DEFAULT_SYSTEM, key: trimmed }));
    setKey('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addKey();
      setAdding(false);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setKey('');
      setAdding(false);
    }
  }

  /** Commit a pending valid key and collapse when focus leaves the editor
   *  entirely, rather than discarding it silently — but not while it just
   *  moves between the input, +, and remove buttons within this editor. */
  function onBlur(event: FocusEvent<HTMLSpanElement>) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    addKey();
    setAdding(false);
  }

  return (
    <span className={`key-editor${compact ? ' key-editor-compact' : ''}`} onBlur={onBlur}>
      {node.externalRefs.map((ref) => (
        <span key={`${ref.system} ${ref.key}`} className="ref-chip">
          {ref.url ? (
            <a href={ref.url} target="_blank" rel="noreferrer" className="ref-link">
              {ref.system !== DEFAULT_SYSTEM && <span className="ref-system">{ref.system}</span>}
              {ref.key}
            </a>
          ) : (
            <>
              {ref.system !== DEFAULT_SYSTEM && <span className="ref-system">{ref.system}</span>}
              {ref.key}
            </>
          )}
          <button
            className="icon-button"
            title="Remove key"
            onClick={() => store.commit((g) => removeExternalRef(g, id, ref.system, ref.key))}
          >
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <input
          className="meta-input ref-input-key"
          placeholder="PT-123"
          value={key}
          autoFocus
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={onKeyDown}
        />
      ) : (
        <button
          className="icon-button ref-add-button"
          title="Add key"
          onClick={() => setAdding(true)}
        >
          +
        </button>
      )}
    </span>
  );
}
