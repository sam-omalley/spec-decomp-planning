/**
 * Per-assignee delivery metrics over the plan, pure. An "assignee" is a
 * `Resource` (`settings.resources`); a scheduling unit's assignee is its
 * `resourceId` (a dangling id counts as Unassigned). Everything here is
 * computed from the *completed* units (status `done` with both actual dates),
 * so it measures realised throughput, not projections. Three families, per
 * the feature request:
 *
 * - estimate vs actual on completed stories (per assignee, aggregated),
 * - completed points per (working) day,
 * - a weekly completion histogram (points + issue count per week).
 *
 * A "story" here is a scheduling unit (topmost group with an own estimate) —
 * the same atom the scheduler and the headline metrics use.
 */

import type { ProjectGraph } from './types.ts';
import { schedulingUnits } from './schedule.ts';
import { elapsedWorkingDays, toDateOnly } from './time.ts';

const DAY_MS = 86_400_000;

/** ISO Monday of the week containing `iso` (weeks start Monday, UTC). */
export function weekStart(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  const dow = new Date(t).getUTCDay(); // 0 = Sun … 6 = Sat
  const toMonday = (dow + 6) % 7; // Mon → 0, Sun → 6
  return new Date(t - toMonday * DAY_MS).toISOString().slice(0, 10);
}

export interface AssigneeStats {
  /** Resource id, or null for the Unassigned bucket. */
  id: string | null;
  name: string;
  /** Resource FTE (null for the Unassigned bucket). */
  fte: number | null;
  /** Completed scheduling units. */
  completedCount: number;
  /** Summed estimate working days over completed units (nulls count as 0). */
  estimateDays: number;
  /** Summed actual working days over completed units. */
  actualDays: number;
  /** actualDays − estimateDays (+ over, − under). */
  varianceDays: number;
  /** Summed effort points over completed units. */
  points: number;
  /** points / actualDays; null when no actual days recorded. */
  pointsPerDay: number | null;
}

export interface AssigneeSeries {
  id: string | null;
  name: string;
  /** One bucket per shared week axis entry (see `weekStarts`). */
  weeks: { points: number; count: number }[];
}

export interface AssigneeMetrics {
  /** One row per assignee: every resource plus Unassigned when it has
   *  completed work. Resources keep settings order; Unassigned sorts last. */
  rows: AssigneeStats[];
  /** Shared week axis (ISO Mondays) spanning the earliest→latest completion,
   *  inclusive with no gaps; empty when nothing is completed. */
  weekStarts: string[];
  /** Per-assignee weekly completion series, aligned to `weekStarts`. */
  series: AssigneeSeries[];
  /** Largest points total in any single (assignee, week) bucket — histogram
   *  scale. 0 when nothing is completed. */
  maxWeekPoints: number;
}

interface Bucket {
  id: string | null;
  name: string;
  fte: number | null;
  completed: { estimate: number | null; actual: number; points: number; finish: string }[];
}

const UNASSIGNED = 'Unassigned';

/** Per-assignee metrics over completed units. */
export function assigneeMetrics(graph: ProjectGraph): AssigneeMetrics {
  const resources = graph.settings.resources;
  const known = new Set(resources.map((r) => r.id));

  // Seed a bucket per resource (in settings order) so the team roster always
  // shows, then a lazily-created Unassigned bucket.
  const buckets = new Map<string | null, Bucket>();
  for (const r of resources) {
    buckets.set(r.id, { id: r.id, name: r.name.trim() || 'Unnamed', fte: r.fte, completed: [] });
  }
  const bucketFor = (resourceId: string | null): Bucket => {
    const key = resourceId !== null && known.has(resourceId) ? resourceId : null;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { id: null, name: UNASSIGNED, fte: null, completed: [] };
      buckets.set(null, bucket);
    }
    return bucket;
  };

  for (const id of schedulingUnits(graph)) {
    const node = graph.nodes[id]!;
    if (node.status !== 'done' || node.actualStart === null || node.actualFinish === null) continue;
    bucketFor(node.resourceId).completed.push({
      estimate: node.durationEstimate,
      actual: elapsedWorkingDays(node.actualStart, node.actualFinish),
      points: node.effort ?? 0,
      finish: toDateOnly(node.actualFinish),
    });
  }

  // Rows: resources first (settings order), Unassigned last if present.
  const ordered: Bucket[] = [
    ...resources.map((r) => buckets.get(r.id)!),
    ...(buckets.has(null) ? [buckets.get(null)!] : []),
  ];

  const rows: AssigneeStats[] = ordered.map((b) => {
    const estimateDays = b.completed.reduce((s, c) => s + (c.estimate ?? 0), 0);
    const actualDays = b.completed.reduce((s, c) => s + c.actual, 0);
    const points = b.completed.reduce((s, c) => s + c.points, 0);
    return {
      id: b.id,
      name: b.name,
      fte: b.fte,
      completedCount: b.completed.length,
      estimateDays,
      actualDays,
      varianceDays: actualDays - estimateDays,
      points,
      pointsPerDay: actualDays > 0 ? points / actualDays : null,
    };
  });

  // Shared week axis: fill from earliest to latest completion week inclusive.
  const finishes = ordered.flatMap((b) => b.completed.map((c) => c.finish));
  const weekStarts: string[] = [];
  if (finishes.length > 0) {
    const starts = finishes.map(weekStart).sort();
    let t = Date.parse(`${starts[0]}T00:00:00Z`);
    const end = Date.parse(`${starts[starts.length - 1]}T00:00:00Z`);
    for (; t <= end; t += 7 * DAY_MS) {
      weekStarts.push(new Date(t).toISOString().slice(0, 10));
    }
  }
  const weekIndex = new Map(weekStarts.map((w, i) => [w, i]));

  let maxWeekPoints = 0;
  const series: AssigneeSeries[] = ordered.map((b) => {
    const weeks = weekStarts.map(() => ({ points: 0, count: 0 }));
    for (const c of b.completed) {
      const i = weekIndex.get(weekStart(c.finish))!;
      weeks[i]!.points += c.points;
      weeks[i]!.count += 1;
      if (weeks[i]!.points > maxWeekPoints) maxWeekPoints = weeks[i]!.points;
    }
    return { id: b.id, name: b.name, weeks };
  });

  return { rows, weekStarts, series, maxWeekPoints };
}
