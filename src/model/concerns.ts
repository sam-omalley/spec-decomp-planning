/**
 * Monitoring signals over the plan (group tree), pure. Answers "what should
 * a delivery lead be worried about right now?" — the health checks a SCRUM
 * team watches, derived from the same scheduling units and projection the
 * rest of the tool uses. Nothing here mutates the graph; it is a read-only
 * projection like `metrics.ts`.
 *
 * Two families of concern:
 * - per-unit: a specific group is late, blocked, unestimated, cycling, or
 *   unassigned.
 * - project-level (`id: null`): a release window (#159) won't be met, the
 *   whole plan is behind target, or the team is under-utilised (not enough
 *   work in progress).
 *
 * Date commitments are milestone-driven once milestones exist: each one
 * raises its own `milestone_late` when its committed work is projected past
 * its target. The project-wide `past_target` is the fallback for a plan
 * with no milestones defined, so nothing regresses for plans that don't use
 * them — but it doesn't double up with per-release signals either.
 *
 * A parking-lot group (#155) and its subtree never raise a concern — being
 * parked out of the schedule is deliberate, not a signal to chase.
 */

import type { ProjectGraph } from './types.ts';
import { childrenOf, isParked } from './graph.ts';
import { cycleIndexOf } from './analysis.ts';
import { scheduleProject, schedulingUnits } from './schedule.ts';
import { milestoneSummaries } from './milestones.ts';
import { calendarDaysBetween, workingDaysInclusive } from './metrics.ts';
import { toDateOnly } from './time.ts';

export type ConcernKind =
  | 'overdue' // started, past its projected finish
  | 'blocked' // manually marked blocked
  | 'cycle' // in a dependency cycle
  | 'unestimated' // leaf group with no duration → not scheduled
  | 'unassigned' // no resource (team defined); medium once started, low otherwise
  | 'thin_wip' // fewer items in progress than capacity
  | 'milestone_late' // a release's committed work is projected past its target
  | 'past_target'; // projected finish beyond the target date

export type Severity = 'high' | 'medium' | 'low';

export interface Concern {
  kind: ConcernKind;
  severity: Severity;
  /** The group this concerns, or null for a project-level concern. */
  id: string | null;
  /** The node title, or a label for project-level concerns. */
  title: string;
  /** Human explanation of the signal. */
  detail: string;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const KIND_RANK: Record<ConcernKind, number> = {
  milestone_late: 0,
  past_target: 1,
  overdue: 2,
  cycle: 3,
  blocked: 4,
  thin_wip: 5,
  unassigned: 6,
  unestimated: 7,
};

function titleOf(graph: ProjectGraph, id: string): string {
  return graph.nodes[id]?.title.trim() || 'Untitled';
}

/** True for a group with no child groups — a leaf of the delivery tree. */
function isLeafGroup(graph: ProjectGraph, id: string): boolean {
  return childrenOf(graph, id).length === 0;
}

/**
 * Every concern worth surfacing, most-severe first. `now` (today) drives the
 * projection and the "past" comparisons; it defaults to `startDate` for
 * deterministic tests, exactly like the scheduler and metrics.
 */
export function analyzeConcerns(
  graph: ProjectGraph,
  now: string = graph.settings.startDate,
): Concern[] {
  const concerns: Concern[] = [];
  const units = schedulingUnits(graph);
  const schedule = scheduleProject(graph, now);
  const cycles = cycleIndexOf(graph);
  const teamDefined = graph.settings.resources.length > 0;

  let inProgress = 0;
  let notStarted = 0;

  for (const id of units) {
    const node = graph.nodes[id]!;
    const started = node.actualStart !== null;
    const done = node.status === 'done' || node.actualFinish !== null;
    if (!done && started) inProgress++;
    if (!done && !started) notStarted++;

    // Late: an in-progress unit whose projected finish is already behind us.
    const scheduled = schedule.groups.get(id);
    if (!done && started && scheduled && scheduled.finish < now) {
      const late = workingDaysInclusive(scheduled.finish, now) - 1;
      concerns.push({
        kind: 'overdue',
        severity: 'high',
        id,
        title: titleOf(graph, id),
        detail: `Started ${toDateOnly(node.actualStart!)}; projected finish ${scheduled.finish} is ${late} working day${late === 1 ? '' : 's'} ago.`,
      });
    }

    // In a dependency cycle — it can't be sequenced.
    if (cycles.has(id)) {
      concerns.push({
        kind: 'cycle',
        severity: 'high',
        id,
        title: titleOf(graph, id),
        detail: 'In a dependency cycle — its order is undefined until the loop is broken.',
      });
    }

    // Work with no owner, once a team exists: medium once it's underway or
    // done (someone is or was doing the work with nothing to attribute it
    // to), low while it's still not started (less urgent — plenty of time
    // to assign before it matters).
    if (teamDefined && node.resourceId === null) {
      const underway = started || done;
      concerns.push({
        kind: 'unassigned',
        severity: underway ? 'medium' : 'low',
        id,
        title: titleOf(graph, id),
        detail: underway
          ? 'No resource assigned — work is in progress or done with nobody credited.'
          : 'No resource assigned — nobody owns this work yet.',
      });
    }
  }

  // Blocked groups (any depth): a manual stop signal. Parked groups (#155)
  // are deliberately parked out of the plan, so they're never a concern.
  for (const node of Object.values(graph.nodes)) {
    if (node.type === 'group' && node.status === 'blocked' && !isParked(graph, node.id)) {
      concerns.push({
        kind: 'blocked',
        severity: 'medium',
        id: node.id,
        title: titleOf(graph, node.id),
        detail: 'Marked blocked — progress is stalled.',
      });
    }
  }

  // Leaf groups with no estimate: invisible to the schedule (a blind spot)
  // — unless the group is parked (#155), where that's the point.
  for (const node of Object.values(graph.nodes)) {
    if (
      node.type === 'group' &&
      node.durationEstimate === null &&
      isLeafGroup(graph, node.id) &&
      !isParked(graph, node.id)
    ) {
      concerns.push({
        kind: 'unestimated',
        severity: 'low',
        id: node.id,
        title: titleOf(graph, node.id),
        detail: 'No duration estimate — excluded from the schedule and projection.',
      });
    }
  }

  // Team under-utilised: work waiting but fewer items in progress than the
  // capacity to run them.
  const capacity = Math.max(1, graph.settings.resources.length);
  if (notStarted > 0 && inProgress < capacity) {
    concerns.push({
      kind: 'thin_wip',
      severity: 'medium',
      id: null,
      title: 'Not enough in progress',
      detail: `${inProgress} unit${inProgress === 1 ? '' : 's'} in progress against a capacity of ${capacity}, with ${notStarted} not yet started — the team could pull in more.`,
    });
  }

  // Release windows (#159): each milestone whose committed work is
  // projected to finish after its target date. An empty milestone raises
  // nothing — there's no commitment to miss yet.
  for (const m of milestoneSummaries(graph, now, schedule)) {
    if (m.finish === null || m.onTrack !== false) continue;
    const over = m.varianceDays!;
    concerns.push({
      kind: 'milestone_late',
      severity: 'high',
      id: null,
      title: `Milestone at risk: ${m.name}`,
      detail: `${m.unitIds.length} committed unit${m.unitIds.length === 1 ? '' : 's'} project to finish ${m.finish}, ${over} calendar day${over === 1 ? '' : 's'} past the ${m.targetDate} target${m.drivingUnit ? ` — last is “${m.drivingUnit.title}”` : ''}.`,
    });
  }

  // Projected to land past the project target date — the fallback signal
  // for a plan with no milestones; with them, the per-release concerns
  // above are the commitment being tracked and this would just double up.
  const { targetDate } = graph.settings;
  if (
    graph.settings.milestones.length === 0 &&
    targetDate &&
    schedule.projectFinish &&
    schedule.projectFinish > targetDate
  ) {
    const over = calendarDaysBetween(targetDate, schedule.projectFinish);
    concerns.push({
      kind: 'past_target',
      severity: 'high',
      id: null,
      title: 'Behind target',
      detail: `Projected finish ${schedule.projectFinish} is ${over} calendar day${over === 1 ? '' : 's'} past the target ${targetDate}.`,
    });
  }

  concerns.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      a.title.localeCompare(b.title),
  );
  return concerns;
}

/**
 * Narrow a concern list to the active severities. Pure so the Concerns view's
 * severity toggle stays a projection (like search/depth view state elsewhere):
 * an empty `active` set means "show none". Preserves input order.
 */
export function filterConcernsBySeverity(
  concerns: readonly Concern[],
  active: ReadonlySet<Severity>,
): Concern[] {
  return concerns.filter((c) => active.has(c.severity));
}
