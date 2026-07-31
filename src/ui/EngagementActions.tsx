/**
 * Engagement → Actions (#163): "a sorted list of actions on me", and the
 * mirror of it — what I'm waiting on from everybody else.
 *
 * Both lists come from one `openActions` query read from either end, so
 * they can't sort or age differently. A topic I haven't raised yet sits in
 * the same list as an assigned action, tagged "to raise": from the point of
 * view of "what do I owe someone", a follow-up reminder and a chore are the
 * same obligation.
 *
 * This is the one view that spans forums — it exists precisely to answer
 * the question the per-meeting Agenda can't.
 */

import { useMemo, useState } from 'react';
import { useWorkspace } from '../engagement/store.ts';
import { todayIso, updateItem } from '../engagement/workspace.ts';
import { openActions, type ActionEntry } from '../engagement/queries.ts';
import type { NagKind } from '../engagement/recency.ts';
import { ItemControls } from './ItemControls.tsx';
import { useEngagementRun } from './useEngagementRun.ts';
import { engagementStore } from '../engagement/store.ts';

const NAG_LABEL: Record<NagKind, string> = {
  unraised: 'not raised yet',
  awaiting_them: 'no movement',
  overdue_action: 'past due',
};

export function EngagementActions() {
  const workspace = useWorkspace();
  const today = todayIso();
  const { run, error, dismiss } = useEngagementRun();
  const entries = useMemo(() => openActions(workspace, today), [workspace, today]);
  // Nagging items only — the same "what should I be worrying about" filter
  // Concerns offers on the plan side. View state, never stored.
  const [staleOnly, setStaleOnly] = useState(false);

  const shown = staleOnly ? entries.filter((e) => e.nag !== null) : entries;
  const mine = shown.filter((e) => e.item.ownerId === null);
  const theirs = shown.filter((e) => e.item.ownerId !== null);
  const nagging = entries.filter((e) => e.nag !== null).length;

  if (entries.length === 0) {
    return (
      <div className="engagement-empty">
        <p className="concerns-clear">✓ Nothing outstanding</p>
        <p className="metric-hint">
          No open topics or actions, for you or for anyone else. Capture one on the Agenda tab and
          it'll appear here until it's resolved.
        </p>
      </div>
    );
  }

  return (
    <div className="engagement-setup">
      {error && (
        <div className="app-banner" role="alert">
          {error}
          <button onClick={dismiss}>Dismiss</button>
        </div>
      )}

      <div className="actions-summary">
        <span className="actions-tally">
          <strong>{mine.length}</strong> on me
        </span>
        <span className="actions-tally">
          <strong>{theirs.length}</strong> on others
        </span>
        <label className="agenda-recurs" title="Only items that have gone stale or past due">
          <input
            type="checkbox"
            checked={staleOnly}
            onChange={(e) => setStaleOnly(e.target.checked)}
          />
          needs chasing ({nagging})
        </label>
      </div>

      <ActionList
        title="On me"
        hint="Topics to raise and actions I owe, most overdue first."
        entries={mine}
        empty={staleOnly ? 'Nothing of mine is overdue.' : 'Nothing on me.'}
        run={run}
        workspace={workspace}
      />
      <ActionList
        title="Waiting on others"
        hint="Actions someone else owes. Raise them at their next forum."
        entries={theirs}
        empty={staleOnly ? "Nobody's overdue." : 'Nothing outstanding with anyone else.'}
        run={run}
        workspace={workspace}
      />
    </div>
  );
}

function ActionList({
  title,
  hint,
  entries,
  empty,
  run,
  workspace,
}: {
  title: string;
  hint: string;
  entries: ActionEntry[];
  empty: string;
  run: ReturnType<typeof useEngagementRun>['run'];
  workspace: ReturnType<typeof useWorkspace>;
}) {
  return (
    <section className="settings-card">
      <div className="settings-card-title">
        <span>{title}</span>
        <span className="agenda-section-count">{entries.length}</span>
      </div>
      <p className="metric-hint">{hint}</p>
      {entries.length === 0 ? (
        <p className="metric-hint">{empty}</p>
      ) : (
        <ul className="agenda-list">
          {entries.map((entry) => (
            <li
              key={entry.item.id}
              className={`agenda-row${entry.overdueDays > 0 ? ' agenda-row-overdue' : ''}`}
            >
              <span
                className={`engagement-dot engagement-dot-${entry.severity}`}
                aria-hidden="true"
              />
              <input
                className="meta-input agenda-row-title"
                type="text"
                aria-label="Title"
                value={entry.item.title}
                onChange={(e) =>
                  run(
                    (ws) => updateItem(ws, entry.item.id, { title: e.target.value }),
                    `item-title:${entry.item.id}`,
                  )
                }
                onBlur={() => engagementStore.breakCoalescing()}
              />
              <span className="agenda-tag" title={`About ${entry.aboutName}`}>
                {entry.aboutName}
              </span>
              {entry.kind === 'to_raise' && (
                <span className="agenda-tag" title="Not raised yet — bring it up">
                  to raise
                </span>
              )}
              {entry.item.link && (
                <span className="agenda-tag agenda-tag-link" title={`Linked to ${entry.item.link.label}`}>
                  ⧉ {entry.item.link.label}
                </span>
              )}
              <ItemControls item={entry.item} workspace={workspace} run={run} />
              <span className="agenda-row-note">
                {entry.overdueDays > 0
                  ? `due ${entry.overdueDays}d ago`
                  : entry.nag !== null
                    ? `${NAG_LABEL[entry.nag]} · ${entry.staleDays}d`
                    : `${entry.staleDays}d old`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
