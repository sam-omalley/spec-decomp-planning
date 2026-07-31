/**
 * Agenda generation (#163): "I'm about to walk into this meeting — what do
 * I need to raise?" Pure and derived, never stored: an agenda is a
 * projection of the live items exactly the way the Timeline is a projection
 * of the plan, so it can't go stale between being generated and being used.
 *
 * Scope is the room, not one person: an item is on a forum's agenda if it
 * targets that forum **or** targets anyone who attends it. That is what
 * makes `ItemTarget` worth having — "budget visibility" belongs to the
 * steering group, "chase the access request" belongs to the ICT rep, and
 * both need to come up when the steering group meets.
 *
 * Four sections, ordered the way the conversation runs: the standing items
 * you always cover, the new things you want to raise, what you're chasing
 * them for, and what you owe them.
 */

import type { Item, Workspace } from './types.ts';
import { addDays, daysBetween } from './recency.ts';

export type AgendaSectionKind = 'standing' | 'to_raise' | 'chase' | 'report_back';

export interface AgendaEntry {
  item: Item;
  /** Why it's here, in one phrase — "due 3 days ago", "last raised 21d ago". */
  note: string;
  /** True when this one is past its due date or overdue to be re-raised. */
  overdue: boolean;
}

export interface AgendaSection {
  kind: AgendaSectionKind;
  entries: AgendaEntry[];
}

export const SECTION_ORDER: readonly AgendaSectionKind[] = [
  'standing',
  'to_raise',
  'chase',
  'report_back',
];

/** True when a standing item is due to come round again on `today`. */
export function standingDue(item: Item, today: string): boolean {
  if (item.recurEveryDays === null) return false;
  if (item.lastRaisedAt === null) return true;
  return addDays(item.lastRaisedAt, item.recurEveryDays) <= today;
}

/** The items in scope for a forum: targeted at it, or at one of its
 *  attendees. Live items only. */
export function itemsForForum(workspace: Workspace, forumId: string): Item[] {
  const forum = workspace.forums.find((f) => f.id === forumId);
  if (!forum) return [];
  const attendees = new Set(forum.attendees);
  return Object.values(workspace.items).filter((item) => {
    if (item.state !== 'to_raise' && item.state !== 'open') return false;
    return item.target.kind === 'forum'
      ? item.target.id === forumId
      : attendees.has(item.target.id);
  });
}

function byUrgency(a: AgendaEntry, b: AgendaEntry): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  const dueA = a.item.dueDate ?? '9999-12-31';
  const dueB = b.item.dueDate ?? '9999-12-31';
  return dueA.localeCompare(dueB) || a.item.createdAt.localeCompare(b.item.createdAt);
}

function dueNote(item: Item, today: string): { note: string; overdue: boolean } {
  if (item.dueDate === null) return { note: '', overdue: false };
  const days = daysBetween(item.dueDate, today);
  if (days > 0) return { note: `due ${days}d ago`, overdue: true };
  if (days === 0) return { note: 'due today', overdue: true };
  return { note: `due in ${-days}d`, overdue: false };
}

/**
 * The agenda for one forum on `now` (ISO date). Sections come back in
 * `SECTION_ORDER` and empty ones are dropped, so an empty array means
 * "nothing to bring" rather than "four empty headings".
 */
export function agendaFor(workspace: Workspace, forumId: string, now: string): AgendaSection[] {
  const today = now.slice(0, 10);
  const buckets: Record<AgendaSectionKind, AgendaEntry[]> = {
    standing: [],
    to_raise: [],
    chase: [],
    report_back: [],
  };

  for (const item of itemsForForum(workspace, forumId)) {
    const due = dueNote(item, today);
    if (item.recurEveryDays !== null) {
      // A standing concern that isn't due again yet stays off the agenda —
      // that's the whole point of the recurrence, not a reason to see it
      // every single time.
      if (!standingDue(item, today)) continue;
      const since = item.lastRaisedAt === null ? null : daysBetween(item.lastRaisedAt, today);
      buckets.standing.push({
        item,
        note: since === null ? 'never raised' : `last raised ${since}d ago`,
        overdue: since !== null && since >= item.recurEveryDays * 2,
      });
      continue;
    }
    if (item.state === 'to_raise') {
      const age = daysBetween(item.createdAt, today);
      buckets.to_raise.push({
        item,
        note: due.note || (age > 0 ? `open ${age}d` : 'new'),
        overdue: due.overdue,
      });
      continue;
    }
    // Raised already: whoever owes the next move decides which list it's on.
    const bucket = item.ownerId === null ? 'report_back' : 'chase';
    const since = item.lastRaisedAt === null ? null : daysBetween(item.lastRaisedAt, today);
    buckets[bucket].push({
      item,
      note: due.note || (since === null ? '' : `last raised ${since}d ago`),
      overdue: due.overdue,
    });
  }

  return SECTION_ORDER.map((kind) => ({ kind, entries: buckets[kind].sort(byUrgency) })).filter(
    (section) => section.entries.length > 0,
  );
}

/** Every live item on the agenda, flattened — what the "log this meeting"
 *  form ticks off. */
export function agendaItemIds(sections: readonly AgendaSection[]): string[] {
  return sections.flatMap((section) => section.entries.map((entry) => entry.item.id));
}
