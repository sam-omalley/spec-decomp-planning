/**
 * Sampled projection (#133): turns the single hard `projectFinish` date
 * into a P50 / P80 range by re-running `scheduleProject` many times, each
 * time drawing every unit's duration from a triangular distribution
 * instead of using the point estimate.
 *
 * Two sources feed a unit's range, explicit wins:
 * - `durationOptimistic` / `durationPessimistic` on the node itself, when
 *   both are set.
 * - Otherwise, this project's own historical accuracy: the mean and
 *   spread of (actual ÷ estimate) across completed units
 *   (`estimateVsActual`), applied around the point estimate. Needs at
 *   least `MIN_HISTORY_SAMPLES` completed units to avoid overreacting to
 *   a single outlier; below that, a unit with no explicit range is
 *   treated as certain.
 * - A unit with no explicit range and no usable history is certain (its
 *   "distribution" is a point at the estimate), so a project with no
 *   ranges entered and no history yet samples to exactly today's
 *   deterministic finish for every draw — P50 and P80 both equal
 *   `projectFinish`, and the fast path below skips sampling entirely.
 *
 * Pure and deterministic: a small seeded PRNG (mulberry32), not
 * `Math.random`, so the same graph always samples the same distribution —
 * the same rule `now` follows by defaulting to `startDate`. Callers that
 * render this (Metrics, Timeline) must memoize on the graph reference,
 * same as any other `scheduleProject`-derived figure.
 */

import type { ProjectGraph, WorkNode } from './types.ts';
import type { Schedule } from './schedule.ts';
import { scheduleProject, schedulingUnits } from './schedule.ts';
import { estimateVsActual } from './metrics.ts';

const DEFAULT_SAMPLES = 300;
const DEFAULT_SEED = 1;
/** Below this many completed units, historical accuracy is too thin a
 *  sample to trust — treated as "no history" rather than reacting to one
 *  or two outliers. */
const MIN_HISTORY_SAMPLES = 2;

/** Deterministic PRNG (mulberry32) — same seed, same sequence, forever. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Samples a triangular(min, mode, max) distribution given u ~ Uniform(0,1). */
function triangular(min: number, mode: number, max: number, u: number): number {
  if (max <= min) return min;
  const m = Math.min(Math.max(mode, min), max);
  const f = (m - min) / (max - min);
  return u < f
    ? min + Math.sqrt(u * (max - min) * (m - min))
    : max - Math.sqrt((1 - u) * (max - min) * (max - m));
}

export interface HistoricalAccuracy {
  /** Mean of (actual ÷ estimate) across completed units — 1.4 means "40%
   *  over, on average". */
  meanRatio: number;
  /** Population standard deviation of that ratio — how much it varies. */
  spread: number;
}

/**
 * This project's own track record: how far completed units' actual
 * duration ran from their estimate. `null` when there isn't enough
 * completed history yet (see `MIN_HISTORY_SAMPLES`) to derive anything.
 */
export function historicalAccuracy(graph: ProjectGraph): HistoricalAccuracy | null {
  const ratios = estimateVsActual(graph)
    .rows.filter((r) => r.estimateDays !== null && r.estimateDays > 0 && r.actualDays !== null)
    .map((r) => r.actualDays! / r.estimateDays!);
  if (ratios.length < MIN_HISTORY_SAMPLES) return null;
  const meanRatio = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  const variance = ratios.reduce((s, r) => s + (r - meanRatio) ** 2, 0) / ratios.length;
  return { meanRatio, spread: Math.sqrt(variance) };
}

interface DurationRange {
  min: number;
  mode: number;
  max: number;
}

/** A not-done unit's sampling range: explicit bounds win; otherwise
 *  historical accuracy shifts and spreads the point estimate; otherwise
 *  the unit is certain (min = mode = max = the estimate). */
function unitRange(node: WorkNode, historical: HistoricalAccuracy | null): DurationRange {
  const estimate = node.durationEstimate ?? 0;
  if (node.durationOptimistic !== null && node.durationPessimistic !== null) {
    const a = node.durationOptimistic;
    const b = node.durationPessimistic;
    return { min: Math.min(a, b, estimate), mode: estimate, max: Math.max(a, b, estimate) };
  }
  if (historical) {
    const mode = estimate * historical.meanRatio;
    const min = Math.max(0, estimate * (historical.meanRatio - historical.spread));
    const max = estimate * (historical.meanRatio + historical.spread);
    return { min: Math.min(min, mode), mode, max: Math.max(max, mode) };
  }
  return { min: estimate, mode: estimate, max: estimate };
}

/** Nearest-rank percentile over dates already sorted ascending — plain
 *  string comparison sorts ISO dates chronologically, so no date parsing
 *  is needed here. */
function percentile(sortedDates: string[], p: number): string | null {
  if (sortedDates.length === 0) return null;
  const idx = Math.min(sortedDates.length - 1, Math.max(0, Math.ceil(p * sortedDates.length) - 1));
  return sortedDates[idx]!;
}

export interface SampledProjection {
  /** Median simulated finish. Equals the deterministic `projectFinish`
   *  when nothing is uncertain. */
  p50: string | null;
  /** 80th-percentile simulated finish — 4 in 5 simulated outcomes finish
   *  on or before this date. */
  p80: string | null;
  /** True when at least one unit actually has a range (explicit or
   *  historical) — i.e. sampling ran for real, rather than the fast path. */
  hasUncertainty: boolean;
}

/**
 * Runs `scheduleProject` `samples` times, each time drawing every not-done
 * unit's duration from its range (`unitRange`), and reports the P50/P80
 * finish. Skips the loop entirely (and its result is exactly the
 * deterministic finish) when no unit has a real range — the "identical to
 * today" no-op the model doc promises.
 */
export function sampleProjection(
  graph: ProjectGraph,
  /** "Today", forwarded to the scheduler — see `scheduleProject`. */
  now: string = graph.settings.startDate,
  /** A precomputed deterministic schedule, to avoid re-running the
   *  scheduler when the caller already has one. */
  schedule: Schedule = scheduleProject(graph, now),
  options?: { samples?: number; seed?: number },
): SampledProjection {
  const historical = historicalAccuracy(graph);
  const ranges = new Map<string, DurationRange>();
  let hasUncertainty = false;
  for (const id of schedulingUnits(graph)) {
    const node = graph.nodes[id]!;
    if (node.actualFinish !== null) continue; // done: real dates, no duration involved
    const range = unitRange(node, historical);
    ranges.set(id, range);
    if (range.max > range.min) hasUncertainty = true;
  }

  if (!hasUncertainty) {
    const finish = schedule.projectFinish;
    return { p50: finish, p80: finish, hasUncertainty: false };
  }

  const samples = options?.samples ?? DEFAULT_SAMPLES;
  const rand = mulberry32(options?.seed ?? DEFAULT_SEED);
  const finishes: string[] = [];
  for (let i = 0; i < samples; i++) {
    const overrides = new Map<string, number>();
    for (const [id, range] of ranges) overrides.set(id, triangular(range.min, range.mode, range.max, rand()));
    const sampled = scheduleProject(graph, now, overrides);
    if (sampled.projectFinish) finishes.push(sampled.projectFinish);
  }
  finishes.sort();

  return { p50: percentile(finishes, 0.5), p80: percentile(finishes, 0.8), hasUncertainty: true };
}
