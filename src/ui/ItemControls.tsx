/**
 * The controls every engagement item row carries, wherever it's shown
 * (#163): who owes it, when it's due, resolve with an outcome, delete.
 * Shared by the Agenda and the Actions list so the two can't drift into
 * offering different affordances for the same item.
 *
 * The owner select's blank option is "Me" — `ownerId: null` means mine
 * throughout the model, which keeps "actions on me" a one-field filter.
 */

import { removeItem, resolveItem, updateItem } from '../engagement/workspace.ts';
import type { Item, Workspace } from '../engagement/types.ts';
import type { EngagementRun } from './useEngagementRun.ts';

export function ItemControls({
  item,
  workspace,
  run,
  showDue = true,
}: {
  item: Item;
  workspace: Workspace;
  run: EngagementRun['run'];
  /** The Agenda hides nothing; a dense list may drop the date field. */
  showDue?: boolean;
}) {
  return (
    <>
      <select
        className="meta-input agenda-row-owner"
        aria-label="Owner"
        value={item.ownerId ?? ''}
        title={item.ownerId === null ? 'Owed by me' : 'Owed by them'}
        onChange={(e) => run((ws) => updateItem(ws, item.id, { ownerId: e.target.value || null }))}
      >
        <option value="">Me</option>
        {workspace.people
          .filter((p) => p.archivedAt === null || p.id === item.ownerId)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
      {showDue && (
        <input
          className="meta-input agenda-row-due"
          type="date"
          aria-label="Due"
          value={item.dueDate ?? ''}
          onChange={(e) => run((ws) => updateItem(ws, item.id, { dueDate: e.target.value || null }))}
        />
      )}
      <button
        className="agenda-row-btn"
        title="Resolve with an outcome"
        onClick={() => {
          const resolution = window.prompt(`Outcome for “${item.title}”`, '');
          if (resolution === null) return;
          run((ws) => resolveItem(ws, item.id, resolution));
        }}
      >
        ✓
      </button>
      <button
        className="project-remove"
        title="Delete this item and anything under it"
        onClick={() => {
          if (window.confirm(`Delete “${item.title}” and anything threaded under it?`)) {
            run((ws) => removeItem(ws, item.id));
          }
        }}
      >
        ×
      </button>
    </>
  );
}
