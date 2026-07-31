/**
 * Read-side projections over the engagement workspace (#163) — the three
 * remaining views the issue asked for, each a pure function over the same
 * items and log the Agenda already reads:
 *
 * - `openActions` — "a sorted list of actions on me". Note that a topic I
 *   haven't raised yet *is* an action on me ("follow up reminders" in the
 *   issue's words), so `to_raise` items owned by me are in the same list as
 *   assigned actions, tagged so the UI can say which is which. Partitioned
 *   by owner rather than computed twice: what I owe and what I'm waiting on
 *   are the same query read from either end.
 * - `logEntries` — "a time based log of all comms with all stakeholders",
 *   with the ids resolved to names and the referenced items attached, so a
 *   log line reads without the caller re-walking the workspace.
 * - `personDossier` — "a per-stakeholder view": their standing, everything
 *   live that concerns them, and their own contact history.
 *
 * Nothing here mutates or caches; like `agenda.ts` these run against the
 * live workspace so a view can't show a stale answer.
 */

import type { Interaction, Item, Person, Workspace } from './types.ts';
import { openItems, personById } from './workspace.ts';
import {
  contactStatuses,
  daysBetween,
  itemNags,
  type ContactSeverity,
  type ContactStatus,
  type NagKind,
} from './recency.ts';

/** Whether the next move is a conversation or a piece of work. */
export type ActionKind = 'to_raise' | 'action';

const SEVERITY_RANK: Record<ContactSeverity, number> = {
  badly_overdue: 0,
  overdue: 1,
  due_soon: 2,
  ok: 3,
};

export interface ActionEntry {
  item: Item;
  kind: ActionKind;
  /** Who owes it — 'Me' for my own. */
  ownerName: string;
  /** Who or what it concerns (the item's target). */
  aboutName: string;
  /** Days past `dueDate`; 0 when not due or undated. */
  overdueDays: number;
  /** Days since it was last raised (or created, if never). */
  staleDays: number;
  /** Why `recency.ts` considers it stale, if it does. */
  nag: NagKind | null;
  severity: ContactSeverity;
}

function nameOfTarget(workspace: Workspace, item: Item): string {
  if (item.target.kind === 'person') {
    return personById(workspace, item.target.id)?.name ?? 'Unknown';
  }
  return workspace.forums.find((f) => f.id === item.target.id)?.name ?? 'Unknown';
}

/**
 * Every live item as an action entry, worst first: overdue by the most,
 * then by due date, then longest untouched. Callers partition on
 * `item.ownerId === null` for "on me" versus "waiting on them" — one query,
 * one sort, read from either end.
 */
export function openActions(workspace: Workspace, now: string): ActionEntry[] {
  const today = now.slice(0, 10);
  const nagByItem = new Map(itemNags(workspace, today).map((nag) => [nag.itemId, nag]));
  return openItems(workspace)
    .map((item): ActionEntry => {
      const nag = nagByItem.get(item.id) ?? null;
      const since = item.lastRaisedAt ?? item.createdAt;
      return {
        item,
        kind: item.state === 'to_raise' ? 'to_raise' : 'action',
        ownerName: item.ownerId === null ? 'Me' : (personById(workspace, item.ownerId)?.name ?? 'Unknown'),
        aboutName: nameOfTarget(workspace, item),
        overdueDays:
          item.dueDate !== null && item.dueDate < today ? daysBetween(item.dueDate, today) : 0,
        staleDays: Math.max(0, daysBetween(since, today)),
        nag: nag?.kind ?? null,
        severity: nag?.severity ?? 'ok',
      };
    })
    .sort(
      (a, b) =>
        // Most overdue first, then anything that has gone stale — an
        // undated item nobody has touched for a month outranks a dated one
        // that isn't due yet, which is the whole point of this list.
        b.overdueDays - a.overdueDays ||
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        (a.item.dueDate ?? '9999-12-31').localeCompare(b.item.dueDate ?? '9999-12-31') ||
        b.staleDays - a.staleDays ||
        a.item.title.localeCompare(b.item.title),
    );
}

export interface LogEntry {
  interaction: Interaction;
  /** The forum it was an occurrence of; null for ad-hoc contact. */
  forumName: string | null;
  participantNames: string[];
  /** Items raised in it, and items it created — resolved, and silently
   *  short of any that have since been deleted. */
  raised: Item[];
  created: Item[];
}

export interface LogFilter {
  /** Only contacts this person took part in. */
  personId?: string | null;
  /** Only occurrences of this forum. */
  forumId?: string | null;
}

/**
 * The comms log, newest first (the workspace already stores it that way).
 * Filters are ANDed; an absent or null filter field means "no constraint".
 */
export function logEntries(workspace: Workspace, filter: LogFilter = {}): LogEntry[] {
  const { personId, forumId } = filter;
  return workspace.interactions
    .filter((interaction) => {
      if (personId != null && !interaction.participants.includes(personId)) return false;
      if (forumId != null && interaction.forumId !== forumId) return false;
      return true;
    })
    .map((interaction) => ({
      interaction,
      forumName:
        interaction.forumId === null
          ? null
          : (workspace.forums.find((f) => f.id === interaction.forumId)?.name ?? 'Unknown'),
      participantNames: interaction.participants.map(
        (id) => personById(workspace, id)?.name ?? 'Unknown',
      ),
      raised: interaction.raisedItemIds.flatMap((id) => (workspace.items[id] ? [workspace.items[id]!] : [])),
      created: interaction.createdItemIds.flatMap((id) => (workspace.items[id] ? [workspace.items[id]!] : [])),
    }));
}

export interface PersonDossier {
  person: Person;
  status: ContactStatus;
  /** Live items about them or owed by them, worst first. */
  actions: ActionEntry[];
  /** Their own contact history, newest first. */
  log: LogEntry[];
}

/** True when this item concerns `personId` — targeted at them, or theirs
 *  to action. (An item targeting a *forum* they attend belongs to the
 *  room, not to them, so it isn't counted here.) */
function concernsPerson(item: Item, personId: string): boolean {
  if (item.ownerId === personId) return true;
  return item.target.kind === 'person' && item.target.id === personId;
}

/** Everything about one stakeholder; null when there's no such person. */
export function personDossier(
  workspace: Workspace,
  personId: string,
  now: string,
): PersonDossier | null {
  const person = personById(workspace, personId);
  if (person === null) return null;
  const status = contactStatuses(workspace, now).find((s) => s.personId === personId);
  return {
    person,
    // An archived person has no contact standing (they're off the roster),
    // but their history still reads — that's the point of archiving.
    status: status ?? {
      personId,
      name: person.name,
      role: person.role,
      cadenceDays: null,
      forumId: null,
      lastContactAt: null,
      dueAt: null,
      overdueDays: 0,
      away: false,
      severity: 'ok',
    },
    actions: openActions(workspace, now).filter((entry) => concernsPerson(entry.item, personId)),
    log: logEntries(workspace, { personId }),
  };
}
