/**
 * Delinquency: "have I actually talked to this person lately, and what have
 * I let go stale?" (#163). Pure, derived, stored nowhere — the same shape as
 * `model/concerns.ts` on the plan side, and the counterpart signal to it:
 * Concerns watches the work, this watches the conversation.
 *
 * Two families, mirroring the two things the issue asked to keep recent:
 *
 * - **Contact recency** (`contactStatuses`) — per person: how often we're
 *   supposed to speak, when we last did, how overdue that makes me. The
 *   cadence is not a field on the person; it is the tightest cadence across
 *   the forums they sit in (see `Forum` in types.ts for why). Someone in no
 *   forum has no expectation and never nags.
 * - **Item staleness** (`itemNags`) — per item, keyed on *who owes the next
 *   move*: a topic I've never got round to raising, an action on someone
 *   else that hasn't moved in a cadence, an action past its due date.
 *
 * Everything is calendar days, not working days: a fortnightly catch-up is
 * 14 days whether or not one of them was a public holiday. A person's `away`
 * ranges silence their signal entirely — nagging someone on annual leave is
 * noise, and the silence is the whole reason they're marked away.
 */

import type { Forum, Item, Person, Workspace } from './types.ts';
import { activePeople, openItems, personById } from './workspace.ts';

/** How stale an item with no cadence to measure against has to get before
 *  it nags. Two weeks: long enough not to shout at a topic raised yesterday,
 *  short enough that "I meant to mention that" surfaces the same month. */
const DEFAULT_STALE_DAYS = 14;

export type ContactSeverity = 'ok' | 'due_soon' | 'overdue' | 'badly_overdue';

const SEVERITY_RANK: Record<ContactSeverity, number> = {
  badly_overdue: 0,
  overdue: 1,
  due_soon: 2,
  ok: 3,
};

const DAY_MS = 86_400_000;

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

/** `date` shifted by whole days, as `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  const at = Date.parse(`${date.slice(0, 10)}T00:00:00Z`) + days * DAY_MS;
  return new Date(at).toISOString().slice(0, 10);
}

/** True when `on` (ISO date) falls inside one of the person's away ranges. */
export function isAway(person: Person, on: string): boolean {
  const day = on.slice(0, 10);
  return person.away.some((range) => day >= range.start && day <= range.end);
}

export interface ContactStatus {
  personId: string;
  name: string;
  role: string;
  /** Tightest cadence across the forums they attend; null = no forum, so
   *  no expectation of contact and never a nag. */
  cadenceDays: number | null;
  /** The forum that sets that cadence, for "via the Monday stand-up". */
  forumId: string | null;
  /** ISO date/datetime of the last interaction they took part in. */
  lastContactAt: string | null;
  /** When contact is next expected (ISO date); null without a cadence. */
  dueAt: string | null;
  /** Days past `dueAt`; 0 when not yet due. */
  overdueDays: number;
  away: boolean;
  severity: ContactSeverity;
}

/** The forum with the tightest cadence among those `personId` attends. */
function tightestForum(workspace: Workspace, personId: string): Forum | null {
  let best: Forum | null = null;
  for (const forum of workspace.forums) {
    if (!forum.attendees.includes(personId)) continue;
    if (best === null || forum.cadenceDays < best.cadenceDays) best = forum;
  }
  return best;
}

/** The most recent interaction `personId` took part in. */
export function lastContactWith(workspace: Workspace, personId: string): string | null {
  let latest: string | null = null;
  for (const interaction of workspace.interactions) {
    if (!interaction.participants.includes(personId)) continue;
    if (latest === null || interaction.at > latest) latest = interaction.at;
  }
  return latest;
}

function severityFor(cadenceDays: number, overdueDays: number, daysUntilDue: number): ContactSeverity {
  if (overdueDays >= cadenceDays) return 'badly_overdue';
  if (overdueDays > 0) return 'overdue';
  // "Due soon" opens a fifth of the cycle out, floored at two days so even
  // the tightest cadence gives a day's notice to prepare: a weekly catch-up
  // warns two days out, a quarterly one with about a fortnight to arrange it.
  if (daysUntilDue <= Math.max(2, Math.round(cadenceDays * 0.2))) return 'due_soon';
  return 'ok';
}

/**
 * Per-person contact standing on `now` (ISO date), worst first. Archived
 * people are excluded — they left; they are not a backlog.
 */
export function contactStatuses(workspace: Workspace, now: string): ContactStatus[] {
  const today = now.slice(0, 10);
  const statuses = activePeople(workspace).map((person): ContactStatus => {
    const forum = tightestForum(workspace, person.id);
    const lastContactAt = lastContactWith(workspace, person.id);
    const away = isAway(person, today);
    if (forum === null) {
      return {
        personId: person.id,
        name: person.name,
        role: person.role,
        cadenceDays: null,
        forumId: null,
        lastContactAt,
        dueAt: null,
        overdueDays: 0,
        away,
        severity: 'ok',
      };
    }
    // Never spoken: count from when the arrangement started, not from the
    // epoch — a forum created today is not instantly a fortnight overdue.
    const anchor =
      lastContactAt ??
      maxDate(forum.anchorDate ?? forum.createdAt.slice(0, 10), person.createdAt.slice(0, 10));
    const dueAt = addDays(anchor, forum.cadenceDays);
    const overdueDays = Math.max(0, daysBetween(dueAt, today));
    const daysUntilDue = daysBetween(today, dueAt);
    return {
      personId: person.id,
      name: person.name,
      role: person.role,
      cadenceDays: forum.cadenceDays,
      forumId: forum.id,
      lastContactAt,
      dueAt,
      overdueDays,
      away,
      // Away silences the nag without hiding the row — the UI still shows
      // when they're back and how overdue it will be by then.
      severity: away ? 'ok' : severityFor(forum.cadenceDays, overdueDays, daysUntilDue),
    };
  });
  return statuses.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.overdueDays - a.overdueDays ||
      a.name.localeCompare(b.name),
  );
}

function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

export interface ForumStatus {
  forumId: string;
  name: string;
  cadenceDays: number;
  /** ISO date/datetime this forum was last logged; null = never held. */
  lastHeldAt: string | null;
  dueAt: string;
  overdueDays: number;
  severity: ContactSeverity;
}

/** Per-forum standing on `now`, worst first — what the agenda header reads. */
export function forumStatuses(workspace: Workspace, now: string): ForumStatus[] {
  const today = now.slice(0, 10);
  return workspace.forums
    .map((forum): ForumStatus => {
      let lastHeldAt: string | null = null;
      for (const interaction of workspace.interactions) {
        if (interaction.forumId !== forum.id) continue;
        if (lastHeldAt === null || interaction.at > lastHeldAt) lastHeldAt = interaction.at;
      }
      const anchor = lastHeldAt ?? forum.anchorDate ?? forum.createdAt.slice(0, 10);
      const dueAt = addDays(anchor.slice(0, 10), forum.cadenceDays);
      const overdueDays = Math.max(0, daysBetween(dueAt, today));
      return {
        forumId: forum.id,
        name: forum.name,
        cadenceDays: forum.cadenceDays,
        lastHeldAt,
        dueAt,
        overdueDays,
        severity: severityFor(forum.cadenceDays, overdueDays, daysBetween(today, dueAt)),
      };
    })
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        b.overdueDays - a.overdueDays ||
        a.name.localeCompare(b.name),
    );
}

/**
 * Why an item is nagging:
 * - `unraised` — I've been sitting on a topic without bringing it up.
 * - `awaiting_them` — raised, they own the action, nothing has moved since.
 * - `overdue_action` — past its due date, whoever owns it.
 */
export type NagKind = 'unraised' | 'awaiting_them' | 'overdue_action';

export interface ItemNag {
  itemId: string;
  title: string;
  kind: NagKind;
  /** Who owes the move; null = me. */
  ownerId: string | null;
  ownerName: string;
  /** Days since the clock started for this nag (or past due, for
   *  `overdue_action`). */
  ageDays: number;
  severity: ContactSeverity;
}

/** The cadence an item is measured against: its forum's, or the tightest
 *  one its person sits in; `DEFAULT_STALE_DAYS` when neither applies. */
function cadenceForItem(workspace: Workspace, item: Item): number {
  if (item.target.kind === 'forum') {
    const forum = workspace.forums.find((f) => f.id === item.target.id);
    return forum?.cadenceDays ?? DEFAULT_STALE_DAYS;
  }
  return tightestForum(workspace, item.target.id)?.cadenceDays ?? DEFAULT_STALE_DAYS;
}

/** True when everyone this item concerns is away on `today` — no point
 *  nagging about a conversation that can't happen. */
function itemBlockedByAway(workspace: Workspace, item: Item, today: string): boolean {
  if (item.target.kind !== 'person') return false;
  const person = personById(workspace, item.target.id);
  return person !== null && isAway(person, today);
}

/**
 * Stale items on `now` (ISO date), worst first. Only live items (`to_raise`
 * / `open`) can nag — a resolved or dropped item is finished business.
 */
export function itemNags(workspace: Workspace, now: string): ItemNag[] {
  const today = now.slice(0, 10);
  const nags: ItemNag[] = [];
  for (const item of openItems(workspace)) {
    if (itemBlockedByAway(workspace, item, today)) continue;
    const cadence = cadenceForItem(workspace, item);
    const ownerName = item.ownerId === null ? 'Me' : (personById(workspace, item.ownerId)?.name ?? 'Unknown');
    const base = { itemId: item.id, title: item.title, ownerId: item.ownerId, ownerName };

    if (item.dueDate !== null && item.dueDate < today && item.state === 'open') {
      const ageDays = daysBetween(item.dueDate, today);
      nags.push({
        ...base,
        kind: 'overdue_action',
        ageDays,
        severity: ageDays >= cadence ? 'badly_overdue' : 'overdue',
      });
      continue;
    }
    if (item.state === 'to_raise' && item.lastRaisedAt === null) {
      const ageDays = daysBetween(item.createdAt, today);
      if (ageDays >= cadence) {
        nags.push({
          ...base,
          kind: 'unraised',
          ageDays,
          severity: ageDays >= cadence * 2 ? 'badly_overdue' : 'overdue',
        });
      }
      continue;
    }
    if (item.state === 'open' && item.ownerId !== null) {
      // Nothing has happened since it was last raised or touched.
      const since = maxDate(item.lastRaisedAt ?? item.createdAt, item.modifiedAt);
      const ageDays = daysBetween(since, today);
      if (ageDays >= cadence) {
        nags.push({
          ...base,
          kind: 'awaiting_them',
          ageDays,
          severity: ageDays >= cadence * 2 ? 'badly_overdue' : 'overdue',
        });
      }
    }
  }
  return nags.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.ageDays - a.ageDays,
  );
}
