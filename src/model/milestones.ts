/**
 * Release/milestone analysis (#159), pure. A `Milestone` (see types.ts) is
 * an *authored* delivery window; this module answers the only question that
 * makes it more than a label: **is the plan going to make it?**
 *
 * Nothing here feeds the scheduler. Placement is computed exactly as it
 * would be with no milestones defined, and the comparison then runs one way
 * — projection → window — the same relationship `settings.targetDate` has
 * always had, just per release and with an owner (the committed groups).
 *
 * Membership is inherited down the group tree: a unit with no `milestoneId`
 * of its own belongs to its nearest ancestor's milestone, so committing a
 * whole block to R1 is one edit rather than one per leaf. A descendant may
 * override with its own id (or clear it, by pointing at another milestone);
 * the nearest id wins, exactly like the "nearest enclosing" rule the
 * scheduler already uses for units.
 */

import type { Milestone, ProjectGraph } from './types.ts';
import type { Schedule } from './schedule.ts';
import { parentOf } from './graph.ts';
import { scheduleProject, schedulingUnits } from './schedule.ts';
import { calendarDaysBetween } from './metrics.ts';

/**
 * The milestone a group is committed to — its own, else the nearest
 * ancestor's; null when nothing up the chain commits it. A `milestoneId`
 * that doesn't match a defined milestone is treated as absent (the same
 * dangling-reference rule `resourceId` follows), so deleting a milestone
 * out from under a stale file can't invent a phantom release.
 */
export function milestoneOf(graph: ProjectGraph, id: string): string | null {
  const defined = new Set(graph.settings.milestones.map((m) => m.id));
  // A residual 'contains' cycle would otherwise hang this walk; the visited
  // set turns it into a wrong answer instead (see isInSubtreeOf in graph.ts).
  const visited = new Set<string>();
  let cur: string | null = id;
  while (cur !== null && !visited.has(cur)) {
    visited.add(cur);
    const mid = graph.nodes[cur]?.milestoneId ?? null;
    if (mid !== null && defined.has(mid)) return mid;
    cur = parentOf(graph, cur);
  }
  return null;
}

export interface MilestoneSummary {
  id: string;
  name: string;
  startDate: string;
  targetDate: string;
  /** Scheduling units committed to this milestone, in plan order. */
  unitIds: string[];
  /** Of those, the ones already done. */
  doneCount: number;
  /** Summed duration estimates (working days) of the committed units, and
   *  of the done ones — the release's own progress figures. */
  totalDays: number;
  doneDays: number;
  /** Earliest scheduled start / latest scheduled finish across the
   *  committed units; null when nothing is committed (or nothing committed
   *  is scheduled). `finish` is what the target date is judged against. */
  start: string | null;
  finish: string | null;
  /** The committed unit that finishes last — what would have to move for
   *  the milestone to land earlier. Null when there are none. */
  drivingUnit: { id: string; title: string } | null;
  /** Calendar days from the target to the projected finish (+ late,
   *  − early); null when nothing is committed. */
  varianceDays: number | null;
  /** finish ≤ targetDate. Null when nothing is committed — an empty
   *  milestone is neither on nor off track, it's just empty. */
  onTrack: boolean | null;
}

function titleOf(graph: ProjectGraph, id: string): string {
  return graph.nodes[id]?.title.trim() || 'Untitled';
}

/**
 * One summary per defined milestone, in the order they're configured.
 * Milestones with no committed work are still returned (with nulls) — an
 * empty release is a real state worth showing in the UI, not an error.
 */
export function milestoneSummaries(
  graph: ProjectGraph,
  /** "Today" — forwarded to the scheduler, like everywhere else. */
  now: string = graph.settings.startDate,
  /** A precomputed schedule, to avoid re-running the scheduler when the
   *  caller already has one. Defaults to running it here. */
  schedule: Schedule = scheduleProject(graph, now),
): MilestoneSummary[] {
  const byMilestone = new Map<string, string[]>();
  for (const id of schedulingUnits(graph)) {
    const mid = milestoneOf(graph, id);
    if (mid === null) continue;
    const list = byMilestone.get(mid);
    if (list) list.push(id);
    else byMilestone.set(mid, [id]);
  }

  return graph.settings.milestones.map((m: Milestone) => {
    const unitIds = byMilestone.get(m.id) ?? [];
    let start: string | null = null;
    let finish: string | null = null;
    let drivingUnit: MilestoneSummary['drivingUnit'] = null;
    let totalDays = 0;
    let doneDays = 0;
    let doneCount = 0;
    for (const id of unitIds) {
      const node = graph.nodes[id]!;
      const days = node.durationEstimate ?? 0;
      totalDays += days;
      if (node.status === 'done') {
        doneCount++;
        doneDays += days;
      }
      const scheduled = schedule.groups.get(id);
      if (!scheduled) continue;
      if (start === null || scheduled.start < start) start = scheduled.start;
      if (finish === null || scheduled.finish > finish) {
        finish = scheduled.finish;
        drivingUnit = { id, title: titleOf(graph, id) };
      }
    }
    const varianceDays = finish === null ? null : calendarDaysBetween(m.targetDate, finish);
    return {
      id: m.id,
      name: m.name.trim() || 'Untitled milestone',
      startDate: m.startDate,
      targetDate: m.targetDate,
      unitIds,
      doneCount,
      totalDays,
      doneDays,
      start,
      finish,
      drivingUnit,
      varianceDays,
      onTrack: varianceDays === null ? null : varianceDays <= 0,
    };
  });
}
