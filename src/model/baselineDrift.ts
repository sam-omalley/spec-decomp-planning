/**
 * Baseline-vs-current drift (#131): answers "what changed since we
 * committed to this?" by re-running the scheduler against a captured
 * `Baseline` and the live graph, then decomposing the difference into the
 * buckets a steering conversation actually asks about — scope added or
 * dropped, estimates revised, and work that started later than planned.
 * Pure; the caller supplies `now` for determinism (see `scheduleProject`).
 */

import { schedulingUnits, scheduleProject, workingDaysBetween } from './schedule.ts';
import type { Baseline, ProjectGraph } from './types.ts';

export interface DriftUnitRef {
  id: string;
  title: string;
}

export interface EstimateChange extends DriftUnitRef {
  before: number | null;
  after: number | null;
}

export interface LateStart extends DriftUnitRef {
  baselineStart: string;
  currentStart: string;
  /** Working days later than the baseline's projected/actual start. */
  deltaDays: number;
}

export interface BaselineDrift {
  baselineId: string;
  baselineLabel: string;
  capturedAt: string;
  baselineFinish: string | null;
  currentFinish: string | null;
  /** currentFinish − baselineFinish in working days; positive = later.
   *  null when either finish is unknown (nothing scheduled). */
  finishDeltaDays: number | null;
  unitsAdded: DriftUnitRef[];
  unitsRemoved: DriftUnitRef[];
  estimateChanges: EstimateChange[];
  lateStarts: LateStart[];
}

function titleOf(graph: ProjectGraph, id: string): string {
  return graph.nodes[id]?.title.trim() || 'Untitled';
}

/** Rebuilds a full `ProjectGraph` from a captured snapshot (its settings
 *  never carry baselines of their own — see the `Baseline` doc comment).
 *  Exported so the Timeline's ghost bars (#131) can re-schedule the same
 *  snapshot without duplicating this reconstruction. */
export function graphOfBaseline(baseline: Baseline): ProjectGraph {
  return {
    nodes: baseline.graph.nodes,
    edges: baseline.graph.edges,
    rootOrder: baseline.graph.rootOrder,
    groupRootOrder: baseline.graph.groupRootOrder,
    settings: { ...baseline.graph.settings, baselines: [] },
  };
}

/** Signed working-day span from `fromIso` to `toIso` (positive = later),
 *  on `graph`'s current holiday calendar. */
function signedWorkingDays(graph: ProjectGraph, fromIso: string, toIso: string): number {
  if (toIso === fromIso) return 0;
  const { holidays } = graph.settings;
  return toIso > fromIso
    ? workingDaysBetween(fromIso, toIso, holidays)
    : -workingDaysBetween(toIso, fromIso, holidays);
}

export function computeDrift(graph: ProjectGraph, baseline: Baseline, now?: string): BaselineDrift {
  const baselineGraph = graphOfBaseline(baseline);
  // The baseline's own projection is re-run as of its own capture-time
  // "now" (`asOfDate`), never `now`/today — see the `Baseline` doc comment
  // in types.ts for why the two must not be conflated.
  const baselineSchedule = scheduleProject(baselineGraph, baseline.asOfDate);
  const currentSchedule = scheduleProject(graph, now);

  const baselineUnits = new Set(schedulingUnits(baselineGraph));
  const currentUnits = new Set(schedulingUnits(graph));

  const unitsAdded: DriftUnitRef[] = [...currentUnits]
    .filter((id) => !baselineUnits.has(id))
    .map((id) => ({ id, title: titleOf(graph, id) }));

  const unitsRemoved: DriftUnitRef[] = [...baselineUnits]
    .filter((id) => !currentUnits.has(id))
    .map((id) => ({ id, title: titleOf(baselineGraph, id) }));

  const estimateChanges: EstimateChange[] = [];
  const lateStarts: LateStart[] = [];
  for (const id of currentUnits) {
    if (!baselineUnits.has(id)) continue; // covered by unitsAdded

    const before = baselineGraph.nodes[id]?.durationEstimate ?? null;
    const after = graph.nodes[id]?.durationEstimate ?? null;
    if (before !== after) {
      estimateChanges.push({ id, title: titleOf(graph, id), before, after });
    }

    const baselineUnit = baselineSchedule.groups.get(id);
    const currentUnit = currentSchedule.groups.get(id);
    if (baselineUnit && currentUnit && currentUnit.start > baselineUnit.start) {
      lateStarts.push({
        id,
        title: titleOf(graph, id),
        baselineStart: baselineUnit.start,
        currentStart: currentUnit.start,
        deltaDays: signedWorkingDays(graph, baselineUnit.start, currentUnit.start),
      });
    }
  }

  const baselineFinish = baselineSchedule.projectFinish;
  const currentFinish = currentSchedule.projectFinish;

  return {
    baselineId: baseline.id,
    baselineLabel: baseline.label,
    capturedAt: baseline.capturedAt,
    baselineFinish,
    currentFinish,
    finishDeltaDays:
      baselineFinish && currentFinish ? signedWorkingDays(graph, baselineFinish, currentFinish) : null,
    unitsAdded,
    unitsRemoved,
    estimateChanges,
    lateStarts,
  };
}
