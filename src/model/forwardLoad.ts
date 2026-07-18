/**
 * Forward-looking per-resource capacity, pure. The Assignees view's other
 * metrics (`assigneeMetrics.ts`) are backward-looking — completed
 * estimate-vs-actual and throughput; this answers the different question
 * "who has room in the *upcoming* schedule, and who's already full?",
 * derived from the same `scheduleProject` output Timeline/Metrics use (no
 * new graph data).
 *
 * Capacity is measured in whole working days per week, not FTE-scaled: a
 * resource's FTE already stretches how long their scheduled work takes
 * (`schedule.ts`), so a slower resource's calendar can still show as fully
 * booked — FTE affects throughput, not how many days they're on the
 * calendar. A day counts as available when it isn't a weekend, a project
 * holiday, or that resource's own leave; committed when some scheduling
 * unit placed on that resource's track (`ScheduledGroup.trackResourceId`)
 * spans it. Utilization is therefore always ≤ 100% by construction, since
 * the scheduler never double-books a single track — the useful signal is
 * *how close* to full a resource is, not overbooking.
 */

import type { DateRange, ProjectGraph } from './types.ts';
import { scheduleProject, schedulingUnits } from './schedule.ts';
import { weekStart } from './assigneeMetrics.ts';

const DAY_MS = 86_400_000;

function addDaysIso(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
function inRanges(iso: string, ranges: readonly DateRange[]): boolean {
  return ranges.some((r) => r.start <= iso && iso <= r.end);
}

export interface ResourceWeekLoad {
  /** ISO Monday. */
  weekStart: string;
  /** Working days available that week (weekdays minus holidays/leave). */
  capacityDays: number;
  /** Working days that week occupied by a unit on this resource's track. */
  committedDays: number;
  /** committedDays / capacityDays; 0 when capacityDays is 0 (e.g. on leave
   *  the whole week). */
  utilization: number;
}

export interface ResourceLoad {
  id: string;
  name: string;
  fte: number;
  weeks: ResourceWeekLoad[];
}

export interface ForwardLoadModel {
  /** Shared week axis (ISO Mondays), starting the week containing `now`. */
  weekStarts: string[];
  /** One row per resource, settings order; empty when there's no team (a
   *  single implicit track has no resource to report on). */
  resources: ResourceLoad[];
}

const DEFAULT_HORIZON_WEEKS = 8;

/** Forward capacity/utilisation per resource over the next `horizonWeeks`. */
export function forwardLoad(
  graph: ProjectGraph,
  now: string = graph.settings.startDate,
  horizonWeeks: number = DEFAULT_HORIZON_WEEKS,
): ForwardLoadModel {
  const resources = graph.settings.resources;
  if (resources.length === 0) return { weekStarts: [], resources: [] };

  const schedule = scheduleProject(graph, now);
  // Unit spans per resource — containers would double-count the same range.
  const unitIds = new Set(schedulingUnits(graph));
  const spansByResource = new Map<string, { start: string; finish: string }[]>();
  for (const r of resources) spansByResource.set(r.id, []);
  for (const id of unitIds) {
    const g = schedule.groups.get(id);
    if (!g || !g.trackResourceId) continue;
    spansByResource.get(g.trackResourceId)?.push({ start: g.start, finish: g.finish });
  }
  const isCommitted = (date: string, resourceId: string): boolean =>
    (spansByResource.get(resourceId) ?? []).some((s) => s.start <= date && date <= s.finish);

  const firstWeek = weekStart(now);
  const weekStarts = Array.from({ length: horizonWeeks }, (_, i) => addDaysIso(firstWeek, i * 7));

  const resourceLoads: ResourceLoad[] = resources.map((r) => {
    const weeks: ResourceWeekLoad[] = weekStarts.map((ws) => {
      let capacityDays = 0;
      let committedDays = 0;
      for (let d = 0; d < 5; d++) {
        const date = addDaysIso(ws, d);
        if (inRanges(date, graph.settings.holidays) || inRanges(date, r.leave)) continue;
        capacityDays++;
        if (isCommitted(date, r.id)) committedDays++;
      }
      return {
        weekStart: ws,
        capacityDays,
        committedDays,
        utilization: capacityDays > 0 ? committedDays / capacityDays : 0,
      };
    });
    return { id: r.id, name: r.name.trim() || 'Unnamed', fte: r.fte, weeks };
  });

  return { weekStarts, resources: resourceLoads };
}
