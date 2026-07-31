/**
 * The controls every engagement item row carries, wherever it's shown
 * (#163): who owes it, when it's due, resolve with an outcome, delete.
 * Shared by the Agenda and the Actions list so the two can't drift into
 * offering different affordances for the same item.
 *
 * The owner select's blank option is "Me" — `ownerId: null` means mine
 * throughout the model, which keeps "actions on me" a one-field filter.
 *
 * Details follow the Things3 pattern the outliner established: a ≡
 * indicator that's solid when there's something to read, opening an inline
 * editor under the row. Same coalescing contract too — see
 * `ItemDetailsEditor`.
 */

import { engagementStore } from '../engagement/store.ts';
import { removeItem, resolveItem, updateItem } from '../engagement/workspace.ts';
import type { Item, Workspace } from '../engagement/types.ts';
import type { EngagementRun } from './useEngagementRun.ts';

export function ItemControls({
  item,
  workspace,
  run,
  showDue = true,
  detailsOpen = false,
  onToggleDetails,
}: {
  item: Item;
  workspace: Workspace;
  run: EngagementRun['run'];
  /** The Agenda hides nothing; a dense list may drop the date field. */
  showDue?: boolean;
  detailsOpen?: boolean;
  /** Omit to leave the details affordance out entirely. */
  onToggleDetails?: () => void;
}) {
  return (
    <>
      {onToggleDetails && (
        <button
          className={`agenda-row-btn item-details-toggle${item.details ? ' item-details-toggle-set' : ''}`}
          aria-expanded={detailsOpen}
          title={item.details ? 'Show details' : 'Add details'}
          onClick={() => {
            // Opening or closing ends the coalescing run: the textarea's
            // blur does not fire when it unmounts, so without this two
            // separate editing sessions would collapse into one undo step
            // (the lesson `Outliner`'s details card learned in #136).
            engagementStore.breakCoalescing();
            onToggleDetails();
          }}
        >
          ≡
        </button>
      )}
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

/**
 * The inline details editor for an item — the "what I actually want to
 * say" note behind a one-line title. Rendered as a sibling of the row's
 * controls (it wraps onto its own line), so it reads as part of the row
 * rather than a separate card.
 *
 * Keystrokes coalesce into one undo step per visit via the
 * `item-details:<id>` key; the visit is ended by `ItemControls`'s toggle
 * (see there) and by blur, so a second visit to the same item is its own
 * step rather than being swallowed by the first.
 */
export function ItemDetailsEditor({
  item,
  run,
}: {
  item: Item;
  run: EngagementRun['run'];
}) {
  return (
    <textarea
      className="meta-input item-details"
      placeholder="Details…"
      rows={2}
      autoFocus
      value={item.details}
      onChange={(e) =>
        run((ws) => updateItem(ws, item.id, { details: e.target.value }), `item-details:${item.id}`)
      }
      onBlur={() => engagementStore.breakCoalescing()}
    />
  );
}
