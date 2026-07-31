/**
 * The engagement tracker's data model (#163) — stakeholder communication,
 * deliberately **separate from `ProjectGraph`**.
 *
 * Why separate: the people you owe a follow-up to are org-level, not
 * project-level. Your PM is the same PM whichever project is open, and the
 * headline view ("everything I owe someone, sorted") is worthless if it
 * silos per project. So this lives in its own workspace record with its own
 * store and its own IndexedDB key, and does not switch when the active
 * project switches. The only tie back to a project is `ProjectLink` — a
 * soft, denormalised reference, never a graph edge.
 *
 * Four nouns, and the generalisations behind them are the point:
 *
 * - `Person` — the roster. Deliberately *not* `Resource` (the scheduler's
 *   team): a stakeholder is someone you talk to, a resource is a scheduling
 *   track, and most stakeholders are neither on your team nor consuming
 *   capacity.
 * - `Forum` — a named contact channel with a cadence and an attendee set.
 *   This subsumes both halves of what the issue asked for: "a frequency of
 *   contact" *or* "a specific meeting time" are the same thing at different
 *   attendee counts. A 1-1 is a forum with one attendee; a steering group is
 *   a forum with five. There is therefore no per-person cadence field — a
 *   person's expected contact interval is the tightest cadence across the
 *   forums they sit in (see `recency.ts`).
 * - `Item` — one type covering both "a topic/concern I want to raise" and
 *   "an action". They are the same shape and differ only in who owes the
 *   next move (`ownerId`) and what that move is (`state`), the same way the
 *   plan side collapsed epics and stories into bare nested groups.
 * - `Interaction` — the append-only log. It is the only thing that stamps
 *   recency, and logging one is also how topics get marked raised and
 *   follow-ups get captured, so a meeting is one write rather than three.
 */

import type { DateRange } from '../model/types.ts';

export type { DateRange };

/**
 * A stakeholder. `away` suppresses the delinquency signal while they're out
 * (annual leave, secondment) — the same idea as a `Resource`'s `leave`, but
 * it gates nagging rather than scheduling.
 */
export interface Person {
  id: string;
  name: string;
  /** Free text — "PM", "ICT rep", "my lead". Display and grouping only. */
  role: string;
  notes: string;
  /** Periods they're unreachable; recency goes quiet across these. */
  away: DateRange[];
  /**
   * ISO datetime they left the picture, or null while active. Archiving
   * rather than deleting is the same lesson `Resource.availableUntil`
   * encodes on the plan side: `removePerson` refuses once there is history,
   * because deleting someone who left would take every interaction and item
   * that records what you agreed with them.
   */
  archivedAt: string | null;
  createdAt: string;
}

/**
 * A recurring contact channel: who is in the room and how often it should
 * happen. `cadenceDays` is calendar days, not working days — "every
 * fortnight" means 14 days whether or not one of them is a public holiday.
 */
export interface Forum {
  id: string;
  name: string;
  /** Expected calendar days between contacts; must be > 0. */
  cadenceDays: number;
  /**
   * An ISO date the cadence counts from when the forum has never been held
   * — otherwise a brand-new forum reads as instantly overdue. Null anchors
   * on the forum's own `createdAt`.
   */
  anchorDate: string | null;
  /** Person ids in the room. */
  attendees: string[];
  notes: string;
  createdAt: string;
}

/**
 * What an item is about — a specific person, or the room itself. A bare
 * `personId` wasn't enough: some concerns belong to a forum ("budget
 * visibility" at the steering group) and shouldn't have to nominate one
 * attendee as a hostage. An agenda pulls both (see `agenda.ts`).
 */
export interface ItemTarget {
  kind: 'person' | 'forum';
  id: string;
}

/**
 * Where an item sits in its own lifecycle:
 * - `to_raise` — I want to bring this up; waiting on an occasion, not on work.
 * - `open` — it's been raised; someone owes an action (`ownerId` says who).
 * - `resolved` — done, with a recorded `resolution`.
 * - `dropped` — closed without action; kept so it doesn't get re-raised.
 */
export type ItemState = 'to_raise' | 'open' | 'resolved' | 'dropped';

/**
 * A soft reference to something in a project graph — a group, a milestone's
 * committed block, a spec node. Soft on purpose: it crosses a store
 * boundary, so it can't be a graph edge and can't be kept referentially
 * honest. `label` is captured at link time so the item still reads properly
 * without loading (or after deleting) the other project.
 */
export interface ProjectLink {
  projectId: string;
  nodeId: string;
  label: string;
}

/**
 * A topic to raise, or an action arising from one. See the module comment
 * for why these are one type. The three shapes in practice:
 *
 * | | target | ownerId | state |
 * |---|---|---|---|
 * | topic to raise | the PM | null (me) | `to_raise` |
 * | action on them | the PM | the PM | `open` |
 * | action on me | the PM | null (me) | `open` |
 */
export interface Item {
  id: string;
  title: string;
  details: string;
  target: ItemTarget;
  /** Who owes the next move; **null means me**, which keeps "actions on me"
   *  a one-field filter and avoids a magic self-person in the roster. */
  ownerId: string | null;
  state: ItemState;
  /** Threading: follow-ups hang under the topic that spawned them, so a
   *  thread reads as its own history. Single-parent, no cycles. */
  parentId: string | null;
  /** Sibling sort position among items with the same `parentId`. */
  order: number;
  dueDate: string | null;
  /**
   * A standing concern — one I re-raise every N calendar days rather than
   * close (the issue's "topics I raise regularly"). It stays `to_raise`
   * forever; `lastRaisedAt` plus this is what keeps it off the agenda until
   * it comes round again. Null = an ordinary one-shot item.
   */
  recurEveryDays: number | null;
  /** ISO datetime it was last raised in a logged interaction; null = never
   *  raised. Written only by `logInteraction`. */
  lastRaisedAt: string | null;
  resolution: string;
  resolvedAt: string | null;
  link: ProjectLink | null;
  createdAt: string;
  modifiedAt: string;
}

/**
 * One logged contact: a meeting, a call, a corridor conversation. The log
 * is append-only history and the sole source of recency — nothing else
 * writes `lastRaisedAt`, and no view infers contact from an item's dates.
 *
 * Note there is no direction field. Staleness is tracked by *who owes the
 * next move* (`Item.ownerId`), not by who initiated the conversation.
 */
export interface Interaction {
  id: string;
  /** ISO date or datetime-local, same convention as the plan's actual
   *  dates: a bare date reads as 00:00 that day. */
  at: string;
  /** The forum this was an occurrence of, or null for an ad-hoc contact. */
  forumId: string | null;
  /** Everyone present. Drives per-person recency, so an ad-hoc chat with
   *  one attendee of a forum resets that person and nobody else. */
  participants: string[];
  note: string;
  /** Items raised here — stamped with `lastRaisedAt` by `logInteraction`. */
  raisedItemIds: string[];
  /** Items captured here (actions agreed in the room). */
  createdItemIds: string[];
}

/**
 * The whole tracker. One record, workspace-scoped: it is not part of any
 * `ProjectGraph` and does not change when the active project changes.
 *
 * `items` is keyed for O(1) lookup (like `ProjectGraph.nodes`);
 * `interactions` is a plain list held newest-first, because the log is
 * read in time order and never in tree order.
 */
export interface Workspace {
  people: Person[];
  forums: Forum[];
  items: Record<string, Item>;
  interactions: Interaction[];
}
