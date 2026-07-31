/**
 * Engagement → Log (#163): "a time based log of all comms with all
 * stakeholders", newest first, filterable to one person or one forum —
 * which is also the per-stakeholder history view.
 *
 * It carries the one piece of authoring the Agenda can't: **ad-hoc
 * contact**. A corridor conversation resets someone's recency exactly like
 * a scheduled meeting does, and without a way to record one the delinquency
 * check would nag about people you actually spoke to yesterday. It's the
 * same `logInteraction` mutation, with no forum attached.
 */

import { useMemo, useState } from 'react';
import { useWorkspace } from '../engagement/store.ts';
import { createId, logInteraction, todayIso } from '../engagement/workspace.ts';
import { logEntries } from '../engagement/queries.ts';
import { useEngagementRun } from './useEngagementRun.ts';

export function EngagementLog() {
  const workspace = useWorkspace();
  const today = todayIso();
  const { run, error, dismiss } = useEngagementRun();

  const [personId, setPersonId] = useState<string | null>(null);
  const [forumId, setForumId] = useState<string | null>(null);
  const entries = useMemo(
    () => logEntries(workspace, { personId, forumId }),
    [workspace, personId, forumId],
  );

  const [at, setAt] = useState(today);
  const [participants, setParticipants] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState('');

  function logAdHoc() {
    const ok = run((ws) =>
      logInteraction(ws, {
        id: createId(),
        at,
        forumId: null,
        participants: [...participants],
        note,
      }),
    );
    if (!ok) return;
    setParticipants(new Set());
    setNote('');
  }

  const roster = workspace.people.filter((p) => p.archivedAt === null);
  const filtered = personId !== null || forumId !== null;

  return (
    <div className="engagement-setup">
      {error && (
        <div className="app-banner" role="alert">
          {error}
          <button onClick={dismiss}>Dismiss</button>
        </div>
      )}

      <section className="settings-card">
        <div className="settings-card-title">
          <span>Record a conversation</span>
        </div>
        <p className="metric-hint">
          For contact outside a scheduled meeting — a corridor chat, a call, an email thread. It
          resets their recency the same way a forum does. To log a meeting with its agenda, use the
          Agenda tab.
        </p>
        <div className="agenda-log-row">
          <label className="meta-field">
            <span className="meta-label">Date</span>
            <input
              className="meta-input"
              type="date"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </label>
          <div className="agenda-log-participants">
            <span className="meta-label">Spoke to</span>
            {roster.length === 0 ? (
              <span className="metric-hint">Add people on the People tab first.</span>
            ) : (
              roster.map((person) => (
                <label
                  key={person.id}
                  className={`engagement-attendee${participants.has(person.id) ? ' engagement-attendee-on' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={participants.has(person.id)}
                    onChange={() =>
                      setParticipants((prev) => {
                        const next = new Set(prev);
                        if (next.has(person.id)) next.delete(person.id);
                        else next.add(person.id);
                        return next;
                      })
                    }
                  />
                  {person.name}
                </label>
              ))
            )}
          </div>
        </div>
        <textarea
          className="meta-input agenda-log-note"
          placeholder="What was said…"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          className="agenda-log-submit"
          onClick={logAdHoc}
          disabled={participants.size === 0}
          title={
            participants.size === 0
              ? 'Tick who you spoke to — that is whose recency this resets'
              : 'Record this conversation'
          }
        >
          Record
        </button>
      </section>

      <section className="settings-card">
        <div className="settings-card-title">
          <span>History</span>
          <span className="agenda-section-count">{entries.length}</span>
        </div>
        <div className="log-filters">
          <label className="meta-field">
            <span className="meta-label">Person</span>
            <select
              className="meta-input"
              value={personId ?? ''}
              onChange={(e) => setPersonId(e.target.value || null)}
            >
              <option value="">Everyone</option>
              {workspace.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="meta-field">
            <span className="meta-label">Forum</span>
            <select
              className="meta-input"
              value={forumId ?? ''}
              onChange={(e) => setForumId(e.target.value || null)}
            >
              <option value="">Any</option>
              {workspace.forums.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          {filtered && (
            <button
              className="engagement-add"
              onClick={() => {
                setPersonId(null);
                setForumId(null);
              }}
            >
              Clear
            </button>
          )}
        </div>

        {entries.length === 0 ? (
          <p className="metric-hint">
            {filtered
              ? 'No contact logged that matches this filter.'
              : 'Nothing logged yet. Record a conversation above, or log a meeting from the Agenda.'}
          </p>
        ) : (
          <ol className="log-list">
            {entries.map((entry) => (
              <li className="log-entry" key={entry.interaction.id}>
                <div className="log-entry-head">
                  <span className="log-date">{entry.interaction.at.slice(0, 10)}</span>
                  <span className="log-forum">{entry.forumName ?? 'Ad-hoc'}</span>
                  <span className="log-people">
                    {entry.participantNames.length === 0
                      ? 'nobody recorded'
                      : entry.participantNames.join(', ')}
                  </span>
                </div>
                {entry.interaction.note && <p className="log-note">{entry.interaction.note}</p>}
                {(entry.raised.length > 0 || entry.created.length > 0) && (
                  <ul className="log-items">
                    {entry.raised.map((item) => (
                      <li key={item.id}>
                        <span className="agenda-tag">raised</span> {item.title}
                      </li>
                    ))}
                    {entry.created.map((item) => (
                      <li key={item.id}>
                        <span className="agenda-tag">action</span> {item.title}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
