/**
 * Delivery metrics over the plan (group tree), pure. Everything is
 * computed from the scheduling units (topmost groups with an own
 * estimate) and the scheduler's projection. Three families:
 *
 * - projectionSummary: headline numbers (projected finish, remaining,
 *   variance vs target).
 * - estimateVsActual: per-unit and rolled estimate-vs-actual duration.
 * - burnUp: cumulative completed vs total scope over time.
 */

import type { ProjectGraph } from './types.ts';
import { scheduleProject, schedulingUnits } from './schedule.ts';

const DAY_MS = 86_400_000;
function utc(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}
/** Signed calendar days from a to b (b − a). */
export function calendarDaysBetween(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / DAY_MS);
}
/** Working days from a to b inclusive (weekends skipped); 0 if b < a. */
export function workingDaysInclusive(a: string, b: string): number {
  if (utc(b) < utc(a)) return 0;
  let count = 0;
  for (let t = utc(a); t <= utc(b); t += DAY_MS) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function isDone(graph: ProjectGraph, id: string): boolean {
  return graph.nodes[id]?.status === 'done';
}

export interface ProjectionSummary {
  projectStart: string | null;
  projectFinish: string | null;
  targetDate: string | null;
  totalDays: number;
  doneDays: number;
  remainingDays: number;
  totalPoints: number;
  remainingPoints: number;
  /** Calendar days the projection lands past the target (+late / −early). */
  varianceDays: number | null;
  onTrack: boolean | null;
}

export function projectionSummary(
  graph: ProjectGraph,
  /** "Today" — forwarded to the scheduler so projections don't date work
   *  in the past. Defaults to `startDate` (no-op) for deterministic tests. */
  now: string = graph.settings.startDate,
): ProjectionSummary {
  const units = schedulingUnits(graph);
  let totalDays = 0;
  let doneDays = 0;
  let remainingDays = 0;
  let totalPoints = 0;
  let remainingPoints = 0;
  for (const id of units) {
    const node = graph.nodes[id]!;
    const days = node.durationEstimate ?? 0;
    const points = node.effort ?? 0;
    totalDays += days;
    totalPoints += points;
    if (isDone(graph, id)) {
      doneDays += days;
    } else {
      remainingDays += days;
      remainingPoints += points;
    }
  }

  const schedule = scheduleProject(graph, now);
  const targetDate = graph.settings.targetDate;
  const varianceDays =
    targetDate && schedule.projectFinish
      ? calendarDaysBetween(targetDate, schedule.projectFinish)
      : null;

  return {
    projectStart: schedule.projectStart,
    projectFinish: schedule.projectFinish,
    targetDate,
    totalDays,
    doneDays,
    remainingDays,
    totalPoints,
    remainingPoints,
    varianceDays,
    onTrack: varianceDays === null ? null : varianceDays <= 0,
  };
}

export interface VarianceRow {
  id: string;
  title: string;
  estimateDays: number | null;
  actualDays: number | null;
  /** actual − estimate working days (+ over, − under). */
  varianceDays: number | null;
}

export interface EstimateVsActual {
  rows: VarianceRow[];
  totalEstimate: number;
  totalActual: number;
}

/** Per done-unit estimate vs actual duration, plus rolled totals. */
export function estimateVsActual(graph: ProjectGraph): EstimateVsActual {
  const rows: VarianceRow[] = [];
  let totalEstimate = 0;
  let totalActual = 0;
  for (const id of schedulingUnits(graph)) {
    const node = graph.nodes[id]!;
    if (!isDone(graph, id) || node.actualStart === null || node.actualFinish === null) continue;
    const estimateDays = node.durationEstimate;
    const actualDays = workingDaysInclusive(node.actualStart, node.actualFinish);
    rows.push({
      id,
      title: node.title.trim() || 'Untitled',
      estimateDays,
      actualDays,
      varianceDays: estimateDays === null ? null : actualDays - estimateDays,
    });
    totalEstimate += estimateDays ?? 0;
    totalActual += actualDays;
  }
  return { rows, totalEstimate, totalActual };
}

export interface BurnPoint {
  date: string;
  done: number;
  total: number;
}

/**
 * Cumulative completed scope (unit duration days) over time — a burn-up.
 * Starts at 0 on the project start, stepping up at each unit's actual
 * finish. `total` is the constant full scope.
 */
export function burnUp(graph: ProjectGraph, now: string = graph.settings.startDate): BurnPoint[] {
  const units = schedulingUnits(graph);
  let total = 0;
  const finishes: { date: string; days: number }[] = [];
  for (const id of units) {
    const node = graph.nodes[id]!;
    const days = node.durationEstimate ?? 0;
    total += days;
    if (isDone(graph, id) && node.actualFinish !== null) {
      finishes.push({ date: node.actualFinish, days });
    }
  }
  if (units.length === 0) return [];
  finishes.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const start = scheduleProject(graph, now).projectStart ?? graph.settings.startDate;
  const points: BurnPoint[] = [{ date: start, done: 0, total }];
  let done = 0;
  for (const f of finishes) {
    done += f.days;
    const last = points[points.length - 1]!;
    if (last.date === f.date) last.done = done;
    else points.push({ date: f.date, done, total });
  }
  return points;
}
