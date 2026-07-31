/**
 * Engagement → Agenda (#163): the working surface of the tracker.
 *
 * Pick a forum and it generates what to bring — the standing concerns due
 * again, new topics to raise, what you're chasing them for, and what you owe
 * them — from the live items (`agenda.ts`), never from a stored agenda that
 * could go stale between generating it and walking into the room.
 *
 * The other half is logging what happened. Ticking items and pressing "Log
 * this meeting" runs one `logInteraction`: the contact is recorded (which is
 * what resets everyone's recency), the ticked items are stamped as raised,
 * and the actions agreed in the room are created — one mutation, so it's one
 * undo step and can't half-apply.
 */

import { useEffect, useMemo, useState } from 'react';
import { engagementStore, useWorkspace } from '../engagement/store.ts';
import { addItem, createId, logInteraction, todayIso, updateItem } from '../engagement/workspace.ts';
import { agendaFor, type AgendaSectionKind } from '../engagement/agenda.ts';
import { agendaMarkdown } from '../engagement/agendaMarkdown.ts';
import { contactStatuses, forumStatuses } from '../engagement/recency.ts';
import type { Item, ProjectLink, Workspace } from '../engagement/types.ts';
import type { NewItem } from '../engagement/workspace.ts';
import { standingText } from './EngagementPeople.tsx';
import { ItemControls, ItemDetailsEditor } from './ItemControls.tsx';
import { useEngagementRun, type EngagementRun } from './useEngagementRun.ts';

const SECTION_LABEL: Record<AgendaSectionKind, string> = {
  standing: 'Standing items',
  to_raise: 'To raise',
  chase: 'Chasing them',
  report_back: 'I owe them',
};

const SECTION_HINT: Record<AgendaSectionKind, string> = {
  standing: 'Concerns you cover every cycle — back when their recurrence comes round.',
  to_raise: "Topics you've captured but not yet brought up.",
  chase: 'Actions they own. Ask where these are up to.',
  report_back: 'Actions you own. Report the outcome, or explain the delay.',
};

/** A draft action agreed in the room, before it's committed with the log. */
interface DraftAction {
  key: string;
  title: string;
  ownerId: string | null;
  /** The agenda item it came out of, if any. */
  parentId: string | null;
}

export function EngagementAgenda({ onOpenLink }: { onOpenLink?: (link: ProjectLink) => void } = {}) {
  const workspace = useWorkspace();
  const today = todayIso();
  const forumStanding = useMemo(() => forumStatuses(workspace, today), [workspace, today]);
  const contacts = useMemo(() => contactStatuses(workspace, today), [workspace, today]);

  // Default to the forum most in need of holding — the one this view exists
  // to catch. Falls back to the first if nothing is overdue.
  const [forumId, setForumId] = useState<string | null>(null);
  const activeForumId =
    forumId !== null && workspace.forums.some((f) => f.id === forumId)
      ? forumId
      : (forumStanding[0]?.forumId ?? null);
  const forum = workspace.forums.find((f) => f.id === activeForumId) ?? null;

  const [raised, setRaised] = useState<ReadonlySet<string>>(new Set());
  const [participants, setParticipants] = useState<ReadonlySet<string>>(new Set());
  const [logDate, setLogDate] = useState(today);
  const [note, setNote] = useState('');
  const [drafts, setDrafts] = useState<DraftAction[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newRecurs, setNewRecurs] = useState(false);
  // Momentary "Copied ✓" on the agenda copy button; cleared whenever the
  // agenda changes underneath it (below), since what's on the clipboard is
  // then no longer what's on screen.
  const [copied, setCopied] = useState(false);
  // Which row's details are open — one at a time, like the outliner's
  // details card. View state; never stored.
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const { run, error, dismiss } = useEngagementRun();
  const banner = error ?? copyError;

  // Switching forum resets the in-progress meeting: the ticks, participants
  // and drafts all belonged to the room you just left.
  useEffect(() => {
    setRaised(new Set());
    setDrafts([]);
    setNote('');
    setParticipants(new Set(forum?.attendees ?? []));
  }, [activeForumId, forum?.attendees]);

  const sections = useMemo(
    () => (activeForumId === null ? [] : agendaFor(workspace, activeForumId, today)),
    [workspace, activeForumId, today],
  );

  // The clipboard holds a snapshot; once the agenda moves on, stop
  // claiming it's copied.
  useEffect(() => {
    setCopied(false);
  }, [sections]);

  function toggle(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  function addTopic() {
    if (!newTitle.trim() || forum === null) return;
    const item: NewItem = {
      id: createId(),
      title: newTitle.trim(),
      target: { kind: 'forum', id: forum.id },
      recurEveryDays: newRecurs ? forum.cadenceDays : null,
    };
    if (run((ws) => addItem(ws, item))) {
      setNewTitle('');
      setNewRecurs(false);
    }
  }

  function logMeeting() {
    if (forum === null) return;
    const created: NewItem[] = drafts
      .filter((d) => d.title.trim() !== '')
      .map((d) => ({
        id: createId(),
        title: d.title.trim(),
        target: { kind: 'forum' as const, id: forum.id },
        ownerId: d.ownerId,
        state: 'open' as const,
        parentId: d.parentId,
      }));
    const ok = run((ws) =>
      logInteraction(ws, {
        id: createId(),
        at: logDate,
        forumId: forum.id,
        participants: [...participants],
        note,
        raisedItemIds: [...raised],
        created,
      }),
    );
    if (!ok) return;
    setRaised(new Set());
    setDrafts([]);
    setNote('');
  }

  if (workspace.forums.length === 0) {
    return (
      <div className="engagement-empty">
        <p className="concerns-clear">No forums yet</p>
        <p className="metric-hint">
          An agenda is generated per forum — a 1-1, a steering group, any regular contact. Add
          the people you deal with and a forum they sit in on the People tab, and this becomes
          the list of what to raise with them.
        </p>
      </div>
    );
  }

  const standing = forumStanding.find((f) => f.forumId === activeForumId);
  const attendeeContacts = contacts.filter((c) => forum?.attendees.includes(c.personId));
  const nothingToBring = sections.length === 0;

  return (
    <div className="agenda-wrap">
      {banner && (
        <div className="app-banner" role="alert">
          {banner}
          <button
            onClick={() => {
              dismiss();
              setCopyError(null);
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      <nav className="agenda-forums" aria-label="Forum">
        {forumStanding.map((f) => (
          <button
            key={f.forumId}
            className={`agenda-forum-pill${f.forumId === activeForumId ? ' agenda-forum-pill-active' : ''}`}
            onClick={() => setForumId(f.forumId)}
            title={`Every ${f.cadenceDays}d · last held ${f.lastHeldAt ?? 'never'}`}
          >
            <span className={`engagement-dot engagement-dot-${f.severity}`} aria-hidden="true" />
            {f.name}
            {f.overdueDays > 0 && <span className="agenda-forum-late">{f.overdueDays}d late</span>}
          </button>
        ))}
      </nav>

      {forum && standing && (
        <header className="agenda-header">
          <h2>{forum.name}</h2>
          <span className="agenda-meta">
            every {forum.cadenceDays}d · last held {standing.lastHeldAt ?? 'never'} · next due{' '}
            {standing.dueAt}
          </span>
          <button
            className="engagement-add"
            title="Copy this agenda as Markdown, to paste into the invite or an email"
            onClick={() => {
              const md = agendaMarkdown(workspace, forum.id, today);
              void navigator.clipboard.writeText(md).then(
                () => {
                  setCopied(true);
                  setCopyError(null);
                },
                () => {
                  // A blocked clipboard must not look like a successful
                  // copy — you'd paste the previous contents into the
                  // invite and never know.
                  setCopied(false);
                  setCopyError(
                    'The browser blocked the clipboard, so the agenda was not copied.',
                  );
                },
              );
            }}
          >
            {copied ? 'Copied ✓' : 'Copy agenda'}
          </button>
          <ul className="agenda-attendees">
            {attendeeContacts.map((c) => (
              <li key={c.personId} className={`engagement-standing engagement-standing-${c.severity}`}>
                <span className={`engagement-dot engagement-dot-${c.severity}`} aria-hidden="true" />
                {c.name}
                <span className="agenda-attendee-standing">
                  {standingText(c.overdueDays, c.dueAt, c.away)}
                </span>
              </li>
            ))}
          </ul>
        </header>
      )}

      {nothingToBring ? (
        <p className="metric-hint agenda-nothing">
          Nothing outstanding for this forum. Add a topic below and it'll be waiting here next
          time.
        </p>
      ) : (
        sections.map((section) => (
          <section className="agenda-section" key={section.kind}>
            <h3>
              {SECTION_LABEL[section.kind]}
              <span className="agenda-section-count">{section.entries.length}</span>
            </h3>
            <p className="metric-hint">{SECTION_HINT[section.kind]}</p>
            <ul className="agenda-list">
              {section.entries.map((entry) => (
                <AgendaRow
                  key={entry.item.id}
                  item={entry.item}
                  note={entry.note}
                  overdue={entry.overdue}
                  workspace={workspace}
                  raised={raised.has(entry.item.id)}
                  onToggleRaised={() => setRaised((prev) => toggle(prev, entry.item.id))}
                  onAddAction={() =>
                    setDrafts((prev) => [
                      ...prev,
                      { key: createId(), title: '', ownerId: null, parentId: entry.item.id },
                    ])
                  }
                  onOpenLink={onOpenLink}
                  detailsOpen={detailsFor === entry.item.id}
                  onToggleDetails={() =>
                    setDetailsFor(detailsFor === entry.item.id ? null : entry.item.id)
                  }
                  run={run}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      <section className="agenda-add">
        <input
          className="meta-input agenda-add-input"
          type="text"
          placeholder="Add a topic to raise…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTopic();
            }
          }}
        />
        <label className="agenda-recurs" title="A standing concern — comes back every cycle">
          <input
            type="checkbox"
            checked={newRecurs}
            onChange={(e) => setNewRecurs(e.target.checked)}
          />
          standing
        </label>
        <button className="engagement-add" onClick={addTopic} disabled={!newTitle.trim()}>
          Add
        </button>
      </section>

      <section className="agenda-log">
        <h3>Log this meeting</h3>
        <p className="metric-hint">
          Records the contact (which is what resets recency), marks the ticked items as raised,
          and captures the actions agreed — as one undoable step.
        </p>
        <div className="agenda-log-row">
          <label className="meta-field">
            <span className="meta-label">Date</span>
            <input
              className="meta-input"
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
            />
          </label>
          <div className="agenda-log-participants">
            <span className="meta-label">Present</span>
            {workspace.people
              .filter((p) => p.archivedAt === null)
              .map((person) => (
                <label
                  key={person.id}
                  className={`engagement-attendee${participants.has(person.id) ? ' engagement-attendee-on' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={participants.has(person.id)}
                    onChange={() => setParticipants((prev) => toggle(prev, person.id))}
                  />
                  {person.name}
                </label>
              ))}
          </div>
        </div>
        <textarea
          className="meta-input agenda-log-note"
          placeholder="What was said…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
        />
        <div className="agenda-drafts">
          {drafts.map((draft) => (
            <div className="agenda-draft" key={draft.key}>
              <input
                className="meta-input"
                type="text"
                placeholder="Action agreed…"
                value={draft.title}
                onChange={(e) =>
                  setDrafts((prev) =>
                    prev.map((d) => (d.key === draft.key ? { ...d, title: e.target.value } : d)),
                  )
                }
              />
              <select
                className="meta-input"
                value={draft.ownerId ?? ''}
                aria-label="Owner"
                onChange={(e) =>
                  setDrafts((prev) =>
                    prev.map((d) =>
                      d.key === draft.key ? { ...d, ownerId: e.target.value || null } : d,
                    ),
                  )
                }
              >
                <option value="">Me</option>
                {workspace.people
                  .filter((p) => p.archivedAt === null)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <button
                className="project-remove"
                title="Drop this action"
                onClick={() => setDrafts((prev) => prev.filter((d) => d.key !== draft.key))}
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="engagement-add"
            onClick={() =>
              setDrafts((prev) => [
                ...prev,
                { key: createId(), title: '', ownerId: null, parentId: null },
              ])
            }
          >
            + Action
          </button>
        </div>
        <button
          className="agenda-log-submit"
          onClick={logMeeting}
          disabled={participants.size === 0}
          title={
            participants.size === 0
              ? 'Tick who was there — the log is what resets their recency'
              : 'Record this meeting'
          }
        >
          Log this meeting
        </button>
      </section>
    </div>
  );
}

/** One agenda line: tick it as raised, retarget who owes it, resolve it. */
function AgendaRow({
  item,
  note,
  overdue,
  workspace,
  raised,
  onToggleRaised,
  onAddAction,
  onOpenLink,
  detailsOpen,
  onToggleDetails,
  run,
}: {
  item: Item;
  note: string;
  overdue: boolean;
  workspace: Workspace;
  raised: boolean;
  onToggleRaised: () => void;
  onAddAction: () => void;
  onOpenLink?: (link: ProjectLink) => void;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  run: EngagementRun['run'];
}) {
  return (
    <li className={`agenda-row${overdue ? ' agenda-row-overdue' : ''}`}>
      <label className="agenda-raise" title="Raised in this meeting">
        <input type="checkbox" checked={raised} onChange={onToggleRaised} />
      </label>
      <input
        className="meta-input agenda-row-title"
        type="text"
        value={item.title}
        aria-label="Title"
        onChange={(e) =>
          run((ws) => updateItem(ws, item.id, { title: e.target.value }), `item-title:${item.id}`)
        }
        onBlur={() => engagementStore.breakCoalescing()}
      />
      {item.recurEveryDays !== null && (
        <span className="agenda-tag" title={`Recurs every ${item.recurEveryDays}d`}>
          standing
        </span>
      )}
      {item.link && (
        <button
          className="agenda-tag agenda-tag-link"
          title={`Open “${item.link.label}” in the plan`}
          onClick={() => onOpenLink?.(item.link!)}
          disabled={!onOpenLink}
        >
          ⧉ {item.link.label}
        </button>
      )}
      <button className="agenda-row-btn" title="Add an action under this item" onClick={onAddAction}>
        +↳
      </button>
      <ItemControls
        item={item}
        workspace={workspace}
        run={run}
        detailsOpen={detailsOpen}
        onToggleDetails={onToggleDetails}
      />
      {note && <span className="agenda-row-note">{note}</span>}
      {detailsOpen && <ItemDetailsEditor item={item} run={run} />}
    </li>
  );
}
