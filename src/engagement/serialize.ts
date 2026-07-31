/**
 * Engagement workspace file format (#163): a versioned JSON envelope, the
 * same shape and discipline as `model/serialize.ts` but for its own record.
 * Used for both the IndexedDB autosave and export/import, so both go
 * through one validation path.
 *
 * v1: initial — people, forums, items, interactions.
 *
 * Loading is the one entrance that bypasses `workspace.ts`'s invariants (a
 * hand-edited file, a partially-written autosave, an item whose person was
 * deleted by an older build). `validateWorkspace` repairs deterministically
 * rather than rejecting the file: dangling references are dropped, thread
 * cycles are broken by re-rooting, and every missing field is backfilled.
 * Losing one attendee id is recoverable; losing the whole log is not.
 */

import type {
  DateRange,
  Forum,
  Interaction,
  Item,
  ItemState,
  ItemTarget,
  Person,
  ProjectLink,
  Workspace,
} from './types.ts';
import { EngagementError, emptyWorkspace, sortInteractions } from './workspace.ts';

export const ENGAGEMENT_FILE_VERSION = 1;

const SUPPORTED_VERSIONS: readonly number[] = [ENGAGEMENT_FILE_VERSION];

const ITEM_STATES: readonly ItemState[] = ['to_raise', 'open', 'resolved', 'dropped'];

export interface EngagementFile {
  version: typeof ENGAGEMENT_FILE_VERSION;
  savedAt: string;
  workspace: Workspace;
}

export function serializeWorkspace(workspace: Workspace): string {
  const file: EngagementFile = {
    version: ENGAGEMENT_FILE_VERSION,
    savedAt: new Date().toISOString(),
    workspace,
  };
  return JSON.stringify(file, null, 2);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function posNumOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function dateRanges(value: unknown): DateRange[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (r): r is DateRange =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as DateRange).start === 'string' &&
        typeof (r as DateRange).end === 'string',
    )
    .map((r) => ({ start: r.start, end: r.end }));
}

function projectLink(value: unknown): ProjectLink | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Partial<ProjectLink>;
  if (typeof raw.projectId !== 'string' || typeof raw.nodeId !== 'string') return null;
  return { projectId: raw.projectId, nodeId: raw.nodeId, label: str(raw.label) };
}

function readPeople(value: unknown): Person[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const people: Person[] = [];
  for (const raw of value as Partial<Person>[]) {
    if (typeof raw?.id !== 'string' || seen.has(raw.id)) continue;
    seen.add(raw.id);
    people.push({
      id: raw.id,
      name: str(raw.name, 'Unnamed'),
      role: str(raw.role),
      notes: str(raw.notes),
      away: dateRanges(raw.away),
      archivedAt: strOrNull(raw.archivedAt),
      createdAt: str(raw.createdAt, new Date().toISOString()),
    });
  }
  return people;
}

function readForums(value: unknown, peopleIds: ReadonlySet<string>): Forum[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const forums: Forum[] = [];
  for (const raw of value as Partial<Forum>[]) {
    if (typeof raw?.id !== 'string' || seen.has(raw.id)) continue;
    seen.add(raw.id);
    forums.push({
      id: raw.id,
      name: str(raw.name, 'Unnamed'),
      cadenceDays: posNumOrNull(raw.cadenceDays) ?? 14,
      anchorDate: strOrNull(raw.anchorDate),
      // Drop attendees whose person is gone rather than keep a forum that
      // silently expects someone who no longer exists.
      attendees: Array.isArray(raw.attendees)
        ? Array.from(new Set(raw.attendees.filter((a): a is string => peopleIds.has(a))))
        : [],
      notes: str(raw.notes),
      createdAt: str(raw.createdAt, new Date().toISOString()),
    });
  }
  return forums;
}

function readTarget(value: unknown): ItemTarget | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Partial<ItemTarget>;
  if ((raw.kind !== 'person' && raw.kind !== 'forum') || typeof raw.id !== 'string') return null;
  return { kind: raw.kind, id: raw.id };
}

function readItems(
  value: unknown,
  peopleIds: ReadonlySet<string>,
  forumIds: ReadonlySet<string>,
): Record<string, Item> {
  if (typeof value !== 'object' || value === null) return {};
  const items: Record<string, Item> = {};
  for (const [id, rawValue] of Object.entries(value as Record<string, Partial<Item>>)) {
    const raw = rawValue ?? {};
    const target = readTarget(raw.target);
    // An item pointing at a person or forum that no longer exists can never
    // reach an agenda and can't be re-targeted from any view — dropping it
    // is the honest outcome, and it only happens to already-broken data.
    if (target === null) continue;
    if (target.kind === 'person' ? !peopleIds.has(target.id) : !forumIds.has(target.id)) continue;
    const at = str(raw.createdAt, new Date().toISOString());
    items[id] = {
      id,
      title: str(raw.title, 'Untitled'),
      details: str(raw.details),
      target,
      ownerId: typeof raw.ownerId === 'string' && peopleIds.has(raw.ownerId) ? raw.ownerId : null,
      state: ITEM_STATES.includes(raw.state as ItemState) ? (raw.state as ItemState) : 'to_raise',
      parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
      order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : 0,
      dueDate: strOrNull(raw.dueDate),
      recurEveryDays: posNumOrNull(raw.recurEveryDays),
      lastRaisedAt: strOrNull(raw.lastRaisedAt),
      resolution: str(raw.resolution),
      resolvedAt: strOrNull(raw.resolvedAt),
      link: projectLink(raw.link),
      createdAt: at,
      modifiedAt: str(raw.modifiedAt, at),
    };
  }
  // Re-root threads whose parent vanished or that form a cycle, so the
  // recursive walks in workspace.ts/agenda.ts can't hang on bad data.
  for (const item of Object.values(items)) {
    if (item.parentId === null) continue;
    if (!items[item.parentId]) {
      item.parentId = null;
      continue;
    }
    const seen = new Set<string>([item.id]);
    let cursor: string | null = item.parentId;
    while (cursor !== null) {
      if (seen.has(cursor)) {
        item.parentId = null;
        break;
      }
      seen.add(cursor);
      cursor = items[cursor]?.parentId ?? null;
    }
  }
  return items;
}

function readInteractions(
  value: unknown,
  peopleIds: ReadonlySet<string>,
  forumIds: ReadonlySet<string>,
  itemIds: ReadonlySet<string>,
): Interaction[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const interactions: Interaction[] = [];
  for (const raw of value as Partial<Interaction>[]) {
    if (typeof raw?.id !== 'string' || seen.has(raw.id)) continue;
    if (typeof raw.at !== 'string') continue;
    seen.add(raw.id);
    const ids = (list: unknown): string[] =>
      Array.isArray(list) ? list.filter((x): x is string => itemIds.has(x)) : [];
    interactions.push({
      id: raw.id,
      at: raw.at,
      forumId: typeof raw.forumId === 'string' && forumIds.has(raw.forumId) ? raw.forumId : null,
      participants: Array.isArray(raw.participants)
        ? Array.from(new Set(raw.participants.filter((p): p is string => peopleIds.has(p))))
        : [],
      note: str(raw.note),
      raisedItemIds: ids(raw.raisedItemIds),
      createdItemIds: ids(raw.createdItemIds),
    });
  }
  return sortInteractions(interactions);
}

/** Repairs a workspace payload of unknown provenance into a valid one. */
export function validateWorkspace(value: unknown): Workspace {
  if (typeof value !== 'object' || value === null) return emptyWorkspace();
  const raw = value as Partial<Workspace>;
  const people = readPeople(raw.people);
  const peopleIds = new Set(people.map((p) => p.id));
  const forums = readForums(raw.forums, peopleIds);
  const forumIds = new Set(forums.map((f) => f.id));
  const items = readItems(raw.items, peopleIds, forumIds);
  const interactions = readInteractions(
    raw.interactions,
    peopleIds,
    forumIds,
    new Set(Object.keys(items)),
  );
  return { people, forums, items, interactions };
}

/**
 * Parses a saved engagement file. Throws `EngagementError` for text that
 * isn't one (so the caller can back it up rather than overwrite it, the
 * same rule `main.tsx` follows for the project autosave); anything that is
 * one is repaired rather than rejected.
 */
export function deserializeWorkspace(text: string): Workspace {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new EngagementError('Not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new EngagementError('Not an engagement file');
  }
  const file = parsed as Partial<EngagementFile>;
  if (typeof file.version !== 'number' || !SUPPORTED_VERSIONS.includes(file.version)) {
    throw new EngagementError(`Unsupported engagement file version: ${String(file.version)}`);
  }
  return validateWorkspace(file.workspace);
}
