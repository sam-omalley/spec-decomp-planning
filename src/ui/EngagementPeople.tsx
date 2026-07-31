/**
 * Engagement → People (#163): the roster behind the agenda — who the
 * stakeholders are, and which forums they sit in.
 *
 * Deliberately not part of the project Settings tab: this is workspace
 * state, not project state, and putting it beside `startDate` and the
 * delivery team would imply it switches when you switch projects. It
 * doesn't.
 *
 * Everything here commits through `engagementStore.commit`, so each edit is
 * undoable and autosaved exactly like a graph edit. The mutations throw on
 * invalid input and a throwing commit would propagate, so inputs are
 * pre-validated at the edge here — same rule `SettingsView` follows.
 */

import { useState } from 'react';
import { DateRangeEditor } from './DateRangeEditor.tsx';
import { engagementStore, useWorkspace } from '../engagement/store.ts';
import {
  EngagementError,
  addForum,
  addPerson,
  createId,
  nowIso,
  personHasHistory,
  removeForum,
  removePerson,
  setForumAttendee,
  updateForum,
  updatePerson,
} from '../engagement/workspace.ts';
import { contactStatuses, forumStatuses } from '../engagement/recency.ts';
import { todayIso } from '../engagement/workspace.ts';
import type { DateRange, Person, Workspace } from '../engagement/types.ts';

/** Human phrase for a contact standing, so severity never rides on colour
 *  alone (the dot is a redundant cue, not the message). */
export function standingText(overdueDays: number, dueAt: string | null, away: boolean): string {
  if (away) return 'away';
  if (dueAt === null) return 'no cadence';
  if (overdueDays > 0) return `${overdueDays}d overdue`;
  return `due ${dueAt}`;
}

export function EngagementPeople() {
  const workspace = useWorkspace();
  const today = todayIso();
  const statuses = contactStatuses(workspace, today);
  const forumStanding = forumStatuses(workspace, today);
  const [error, setError] = useState<string | null>(null);

  /** Runs a mutation, surfacing an `EngagementError` as a banner instead of
   *  letting it throw through the commit (which would fail silently to the
   *  user). `coalesce` collapses a run of keystrokes into one undo step. */
  function run(mutate: (ws: Workspace) => Workspace, coalesce?: string): void {
    try {
      engagementStore.commit(mutate, coalesce ? { coalesce } : undefined);
      setError(null);
    } catch (e) {
      if (e instanceof EngagementError) setError(e.message);
      else throw e;
    }
  }

  /** Both adds drop in an empty row to type into, rather than a modal
   *  prompt — same pattern as the delivery team in Settings. */
  function newPerson() {
    run((ws) => addPerson(ws, { id: createId(), name: '' }));
  }

  function newForum() {
    // Anchored today so a brand-new forum isn't instantly overdue.
    run((ws) => addForum(ws, { id: createId(), name: '', cadenceDays: 14, anchorDate: today }));
  }

  function deletePerson(person: Person) {
    if (personHasHistory(workspace, person.id)) {
      if (
        !window.confirm(
          `${person.name} has items or logged contact. Archive them instead? ` +
            'They drop off the agenda and the recency checks, but every item and ' +
            'meeting that records what you agreed with them is kept.',
        )
      ) {
        return;
      }
      run((ws) => updatePerson(ws, person.id, { archivedAt: nowIso() }));
      return;
    }
    if (!window.confirm(`Delete ${person.name}?`)) return;
    run((ws) => removePerson(ws, person.id));
  }

  return (
    <div className="engagement-setup">
      {error && (
        <div className="app-banner" role="alert">
          {error}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <section className="settings-card">
        <div className="settings-card-title">
          <span>People</span>
          <button className="engagement-add" onClick={newPerson}>
            + Person
          </button>
        </div>
        {workspace.people.length === 0 ? (
          <p className="metric-hint">
            No stakeholders yet. Add the people you need to stay in contact with — your lead,
            your PM, the ICT rep — then put them in a forum below to set how often you should
            be talking.
          </p>
        ) : (
          <ul className="engagement-roster">
            {workspace.people.map((person) => {
              const status = statuses.find((s) => s.personId === person.id);
              const archived = person.archivedAt !== null;
              return (
                <li
                  key={person.id}
                  className={`engagement-person${archived ? ' engagement-person-archived' : ''}`}
                >
                  <div className="engagement-person-main">
                    <input
                      className="meta-input engagement-person-name"
                      type="text"
                      value={person.name}
                      aria-label="Name"
                      onChange={(e) =>
                        run(
                          (ws) => updatePerson(ws, person.id, { name: e.target.value }),
                          `person-name:${person.id}`,
                        )
                      }
                      onBlur={() => engagementStore.breakCoalescing()}
                    />
                    <input
                      className="meta-input engagement-person-role"
                      type="text"
                      placeholder="Role (PM, ICT rep…)"
                      aria-label="Role"
                      value={person.role}
                      onChange={(e) =>
                        run(
                          (ws) => updatePerson(ws, person.id, { role: e.target.value }),
                          `person-role:${person.id}`,
                        )
                      }
                      onBlur={() => engagementStore.breakCoalescing()}
                    />
                    {status && !archived && (
                      <span
                        className={`engagement-standing engagement-standing-${status.severity}`}
                        title={
                          status.cadenceDays === null
                            ? 'Not in any forum — no contact cadence expected'
                            : `Every ${status.cadenceDays}d · last contact ${status.lastContactAt ?? 'never'}`
                        }
                      >
                        <span
                          className={`engagement-dot engagement-dot-${status.severity}`}
                          aria-hidden="true"
                        />
                        {standingText(status.overdueDays, status.dueAt, status.away)}
                      </span>
                    )}
                    {archived && <span className="engagement-standing">archived</span>}
                    {archived ? (
                      <button
                        className="project-switch"
                        title="Bring them back onto the roster"
                        onClick={() => run((ws) => updatePerson(ws, person.id, { archivedAt: null }))}
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        className="project-remove"
                        title="Delete or archive this person"
                        onClick={() => deletePerson(person)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <label className="engagement-away">
                    <span className="meta-label">Away</span>
                    <DateRangeEditor
                      compact
                      ranges={person.away}
                      onAdd={(range: DateRange) =>
                        run((ws) => updatePerson(ws, person.id, { away: [...person.away, range] }))
                      }
                      onRemove={(index) =>
                        run((ws) =>
                          updatePerson(ws, person.id, {
                            away: person.away.filter((_, i) => i !== index),
                          }),
                        )
                      }
                    />
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="settings-card">
        <div className="settings-card-title">
          <span>Forums</span>
          <button className="engagement-add" onClick={newForum}>
            + Forum
          </button>
        </div>
        <p className="metric-hint">
          A forum is any regular contact — a 1-1 is a forum with one attendee, a steering group
          is a forum with five. Its cadence is what the recency check measures you against;
          somebody in no forum is never chased.
        </p>
        {workspace.forums.map((forum) => {
          const standing = forumStanding.find((f) => f.forumId === forum.id)!;
          return (
            <div className="engagement-forum" key={forum.id}>
              <div className="engagement-forum-main">
                <input
                  className="meta-input engagement-forum-name"
                  type="text"
                  aria-label="Forum name"
                  value={forum.name}
                  onChange={(e) =>
                    run(
                      (ws) => updateForum(ws, forum.id, { name: e.target.value }),
                      `forum-name:${forum.id}`,
                    )
                  }
                  onBlur={() => engagementStore.breakCoalescing()}
                />
                <label className="meta-field engagement-cadence">
                  <span className="meta-label">Every</span>
                  <input
                    className="meta-input"
                    type="number"
                    min={1}
                    value={forum.cadenceDays}
                    onChange={(e) => {
                      const days = Number(e.target.value);
                      if (days > 0) run((ws) => updateForum(ws, forum.id, { cadenceDays: days }));
                    }}
                  />
                  <span className="meta-label">days</span>
                </label>
                <span
                  className={`engagement-standing engagement-standing-${standing.severity}`}
                  title={`Last held ${standing.lastHeldAt ?? 'never'} · next due ${standing.dueAt}`}
                >
                  <span
                    className={`engagement-dot engagement-dot-${standing.severity}`}
                    aria-hidden="true"
                  />
                  {standing.overdueDays > 0
                    ? `${standing.overdueDays}d overdue`
                    : `due ${standing.dueAt}`}
                </span>
                <button
                  className="project-remove"
                  title="Delete this forum"
                  onClick={() => {
                    if (window.confirm(`Delete ${forum.name}?`)) {
                      run((ws) => removeForum(ws, forum.id));
                    }
                  }}
                >
                  ×
                </button>
              </div>
              <div className="engagement-attendees">
                {workspace.people.filter((p) => p.archivedAt === null).length === 0 ? (
                  <span className="metric-hint">Add people above to put them in this forum.</span>
                ) : (
                  workspace.people
                    .filter((p) => p.archivedAt === null)
                    .map((person) => {
                      const attending = forum.attendees.includes(person.id);
                      return (
                        <label
                          key={person.id}
                          className={`engagement-attendee${attending ? ' engagement-attendee-on' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={attending}
                            onChange={(e) =>
                              run((ws) =>
                                setForumAttendee(ws, forum.id, person.id, e.target.checked),
                              )
                            }
                          />
                          {person.name}
                        </label>
                      );
                    })
                )}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
