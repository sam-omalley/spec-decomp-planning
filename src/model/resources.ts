/**
 * Resource availability over time (#161), pure. A team is not fixed for the
 * life of a project: people join, contracts end, someone moves off. Each
 * `Resource` carries an optional window (`availableFrom` / `availableUntil`)
 * saying when they are on the team; everything here reads that window.
 *
 * The window gates **projection only** — the scheduler won't place
 * not-yet-started work on a closed track, the forward-load view credits no
 * capacity outside it, and Concerns counts only the people actually around.
 * What already happened is untouched: a done unit keeps its dates and its
 * `resourceId`, so a departed team member stays the recorded assignee of
 * everything they finished. Deleting the resource is the destructive
 * alternative this exists to avoid (`removeResource` in `graph.ts` clears
 * `resourceId` everywhere, losing exactly that history).
 */

import type { ProjectSettings, Resource } from './types.ts';

/**
 * Where a resource sits relative to a date:
 * - 'upcoming' — joins later (`availableFrom` is after `on`)
 * - 'active'   — on the team that day
 * - 'former'   — left already (`availableUntil` is before `on`)
 */
export type ResourceStanding = 'upcoming' | 'active' | 'former';

/** A resource's standing on `on` (ISO date); no window at all = 'active'. */
export function standingOn(resource: Resource, on: string): ResourceStanding {
  if (resource.availableFrom !== null && on < resource.availableFrom) return 'upcoming';
  if (resource.availableUntil !== null && on > resource.availableUntil) return 'former';
  return 'active';
}

/** True when the resource is on the team on `on` (ISO date). */
export function isAvailableOn(resource: Resource, on: string): boolean {
  return standingOn(resource, on) === 'active';
}

/**
 * True when the resource is on the team at some point on/after `from` — i.e.
 * still relevant to a forward-looking view. A member who left before `from`
 * is not; one who joins later still is.
 */
export function isAvailableEverAfter(resource: Resource, from: string): boolean {
  return resource.availableUntil === null || resource.availableUntil >= from;
}

/** The resources on the team on `on` (ISO date), in settings order. */
export function availableResources(settings: ProjectSettings, on: string): Resource[] {
  return settings.resources.filter((r) => isAvailableOn(r, on));
}

/**
 * A short human phrase for a non-'active' standing — "left 2026-08-01",
 * "joins 2026-09-01" — for the concern detail and the UI's roster tags.
 * Null when the resource is simply on the team (nothing to explain).
 */
export function standingLabel(resource: Resource, on: string): string | null {
  const standing = standingOn(resource, on);
  if (standing === 'former') return `left ${resource.availableUntil}`;
  if (standing === 'upcoming') return `joins ${resource.availableFrom}`;
  return null;
}
