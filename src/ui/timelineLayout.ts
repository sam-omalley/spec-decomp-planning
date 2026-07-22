/**
 * Pure layout for the timeline / Gantt view. Turns the scheduler's output
 * into positioned rows (fractions in [0,1] across the date range, so the
 * SVG view just multiplies by a pixel width), plus planned-start/now/
 * target/projected-finish markers and weekly gridline ticks. No pixels
 * here — all geometry is fraction-based and unit-testable.
 */

import type { Baseline, ProjectGraph } from '../model/types.ts';
import { childrenOf, groupRootsOf } from '../model/graph.ts';
import { scheduleProject } from '../model/schedule.ts';
import { sampleProjection } from '../model/uncertainty.ts';
import { graphOfBaseline } from '../model/baselineDrift.ts';
import { rootGroupColor } from './colors.ts';

export interface TimelineRow {
  id: string;
  title: string;
  depth: number;
  color: string;
  isUnit: boolean;
  source: 'planned' | 'actual';
  /** On the dependency critical path to the projected finish. */
  critical: boolean;
  start: string;
  finish: string;
  startFrac: number;
  endFrac: number;
  /** This unit's raw duration estimate (working days), when it has one. */
  durationEstimate: number | null;
  /**
   * A human-readable explanation of why the scheduled span is longer (or
   * shorter) than `durationEstimate` alone implies — present only when the
   * scheduler's speed/FTE stretch on this unit isn't a 1× no-op (see
   * `ScheduledGroup.stretch` in `schedule.ts`).
   */
  stretchNote?: string;
  /** End of this unit's slack (float) window, as a fraction — a trailing
   *  indicator past `endFrac` showing how far the finish could slip without
   *  moving the project's projected finish. Present only when there's slack
   *  to show (see `ScheduledGroup.slackUntil` in `schedule.ts`). */
  slackEndFrac?: number;
  /** This unit's span in the selected baseline (#131), on the same [0,1]
   *  axis as `startFrac`/`endFrac` — present only when a baseline is
   *  selected and this unit existed in it (drawn as a ghost bar). */
  baselineStartFrac?: number;
  baselineEndFrac?: number;
}

export interface TimelineMarker {
  frac: number;
  date: string;
  /** 'start'/'now' are always present; 'target' only when set, 'finish'
   *  only once the scheduler has a projected finish; 'p80' only when the
   *  sampled projection (#133) found real uncertainty and its 80th
   *  percentile lands on a different date than the deterministic finish —
   *  the "whisker" past the finish line, see `sampleProjection`. */
  kind: 'start' | 'now' | 'finish' | 'target' | 'p80';
}

/** Markers sharing a date (e.g. `now` lands on the planned start, or the
 *  projected finish lands exactly on the target date) merged into one
 *  label — otherwise their text draws on top of itself and is unreadable
 *  (#104). Grouped by exact date, not pixel proximity: zooming in already
 *  separates markers that only *look* close, but two on the same date
 *  stay on the same pixel at every zoom level. */
export interface TimelineMarkerGroup {
  frac: number;
  date: string;
  kinds: TimelineMarker['kind'][];
}

/** Groups `markers` by date, preserving first-seen order (start/now, then
 *  whichever of finish/target apply). */
export function groupMarkersByDate(markers: TimelineMarker[]): TimelineMarkerGroup[] {
  const groups: TimelineMarkerGroup[] = [];
  for (const m of markers) {
    const existing = groups.find((g) => g.date === m.date);
    if (existing) existing.kinds.push(m.kind);
    else groups.push({ frac: m.frac, date: m.date, kinds: [m.kind] });
  }
  return groups;
}

export interface TimelineTick {
  frac: number;
  label: string;
}

/** A contiguous non-working band across the date range — a weekend run,
 *  a project holiday, or the two merged when adjacent. */
export interface TimelineWeekendBand {
  startFrac: number;
  endFrac: number;
}

export interface TimelineModel {
  rows: TimelineRow[];
  markers: TimelineMarker[];
  ticks: TimelineTick[];
  weekends: TimelineWeekendBand[];
  rangeStart: string;
  rangeEnd: string;
  /** Whole days spanned by [rangeStart, rangeEnd] — lets the view derive a
   *  sensible zoom-in limit (e.g. never zoom narrower than a day) without
   *  redoing the date math. */
  rangeDays: number;
  empty: boolean;
  /** True when the sampled projection (#133) found real uncertainty and
   *  drew a 'p80' marker — lets the view show an explanatory legend line
   *  only when there's a whisker on the chart to explain. */
  hasUncertainty: boolean;
}

const DAY_MS = 86_400_000;

function utc(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}
function daysBetween(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / DAY_MS);
}
function addDaysIso(iso: string, n: number): string {
  return new Date(utc(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Trims a number to at most 2 decimals, dropping a trailing `.00`/`0`. */
function formatDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Explains why a unit's scheduled span is longer (or shorter) than its raw
 * `durationEstimate` alone implies: the speed multiplier and/or resource FTE
 * that stretched it into working days (see `ScheduledGroup.stretch`).
 */
function stretchNote(
  durationEstimate: number,
  stretch: { speedMultiplier: number; fte: number },
): string {
  const effective = durationEstimate / (stretch.speedMultiplier * stretch.fte);
  const factors: string[] = [];
  if (stretch.speedMultiplier !== 1) factors.push(`${formatDays(stretch.speedMultiplier)}× speed`);
  if (stretch.fte !== 1) factors.push(`${formatDays(stretch.fte)} FTE`);
  return `${formatDays(durationEstimate)}d estimate ÷ ${factors.join(' × ')} = ${formatDays(effective)} working days`;
}

const EMPTY: TimelineModel = {
  rows: [],
  markers: [],
  ticks: [],
  weekends: [],
  rangeStart: '',
  rangeEnd: '',
  rangeDays: 0,
  empty: true,
  hasUncertainty: false,
};

export function buildTimeline(
  graph: ProjectGraph,
  /** "Today" — forwarded to the scheduler so projected bars don't start in
   *  the past. Defaults to `startDate` (no-op) for deterministic tests. */
  now: string = graph.settings.startDate,
  /** Selected baseline (#131) to draw as a ghost bar behind each current
   *  bar, or null/absent for none. */
  baseline?: Baseline | null,
): TimelineModel {
  const schedule = scheduleProject(graph, now);
  // The baseline's own projection is re-run as of its own capture-time
  // "now" (`asOfDate`), never the live `now` — see the `Baseline` doc
  // comment in types.ts for why the two must not be conflated.
  const baselineSchedule = baseline
    ? scheduleProject(graphOfBaseline(baseline), baseline.asOfDate)
    : null;
  const sampled = sampleProjection(graph, now, schedule);

  // Groups in pre-order, with depth, that actually got scheduled.
  const ordered: { id: string; depth: number }[] = [];
  const visit = (id: string, depth: number): void => {
    if (graph.nodes[id]?.type !== 'group') return;
    ordered.push({ id, depth });
    for (const child of childrenOf(graph, id)) visit(child, depth + 1);
  };
  for (const root of groupRootsOf(graph)) visit(root, 0);
  const scheduled = ordered.filter((o) => schedule.groups.has(o.id));
  if (scheduled.length === 0) return EMPTY;

  let rangeStart = schedule.groups.get(scheduled[0]!.id)!.start;
  let rangeEnd = schedule.groups.get(scheduled[0]!.id)!.finish;
  for (const { id } of scheduled) {
    const g = schedule.groups.get(id)!;
    if (g.start < rangeStart) rangeStart = g.start;
    if (g.finish > rangeEnd) rangeEnd = g.finish;
    // A ghost bar's span must land inside [0,1] too, same as the markers
    // extend the range below.
    const bg = baselineSchedule?.groups.get(id);
    if (bg) {
      if (bg.start < rangeStart) rangeStart = bg.start;
      if (bg.finish > rangeEnd) rangeEnd = bg.finish;
    }
  }
  const target = graph.settings.targetDate;
  const p80Date = sampled.hasUncertainty && sampled.p80 !== schedule.projectFinish ? sampled.p80 : null;
  // Extend the range so every marker below (planned start, now, target,
  // the P80 whisker) lands inside [0,1] instead of getting clamped to an
  // edge by frac().
  for (const d of [graph.settings.startDate, now, target, p80Date].filter(
    (v): v is string => v !== null,
  )) {
    if (d < rangeStart) rangeStart = d;
    if (d > rangeEnd) rangeEnd = d;
  }

  const span = Math.max(1, daysBetween(rangeStart, rangeEnd));
  const frac = (iso: string): number => {
    const f = daysBetween(rangeStart, iso) / span;
    return f < 0 ? 0 : f > 1 ? 1 : f;
  };

  const criticalSet = new Set(schedule.criticalPath);
  const rows: TimelineRow[] = scheduled.map(({ id, depth }) => {
    const g = schedule.groups.get(id)!;
    const durationEstimate = graph.nodes[id]?.durationEstimate ?? null;
    return {
      id,
      title: graph.nodes[id]?.title.trim() || 'Untitled',
      depth,
      color: rootGroupColor(graph, id),
      isUnit: g.isUnit,
      source: g.source,
      critical: criticalSet.has(id),
      start: g.start,
      finish: g.finish,
      startFrac: frac(g.start),
      endFrac: frac(g.finish),
      durationEstimate,
      ...(g.stretch && durationEstimate !== null
        ? { stretchNote: stretchNote(durationEstimate, g.stretch) }
        : {}),
      ...(g.slackUntil ? { slackEndFrac: frac(g.slackUntil) } : {}),
      ...(() => {
        const bg = baselineSchedule?.groups.get(id);
        return bg ? { baselineStartFrac: frac(bg.start), baselineEndFrac: frac(bg.finish) } : {};
      })(),
    };
  });

  const markers: TimelineMarker[] = [
    { frac: frac(graph.settings.startDate), date: graph.settings.startDate, kind: 'start' },
    { frac: frac(now), date: now, kind: 'now' },
  ];
  if (schedule.projectFinish) {
    markers.push({ frac: frac(schedule.projectFinish), date: schedule.projectFinish, kind: 'finish' });
  }
  if (target) markers.push({ frac: frac(target), date: target, kind: 'target' });
  if (p80Date) markers.push({ frac: frac(p80Date), date: p80Date, kind: 'p80' });

  // Gridlines: daily for a short range (enough width per label to stay
  // readable), else weekly from the first Monday on/after rangeStart — a
  // long project would otherwise get cluttered with too many labels.
  const ticks: TimelineTick[] = [];
  const DAILY_THRESHOLD = 14; // days
  if (span <= DAILY_THRESHOLD) {
    for (let d = 0; d <= span; d++) {
      const date = new Date(utc(addDaysIso(rangeStart, d)));
      ticks.push({ frac: d / span, label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}` });
    }
  } else {
    const startDow = new Date(utc(rangeStart)).getUTCDay(); // 0=Sun
    const toMonday = (8 - (startDow === 0 ? 7 : startDow)) % 7;
    for (let d = toMonday; d <= span; d += 7) {
      const date = new Date(utc(addDaysIso(rangeStart, d)));
      ticks.push({ frac: d / span, label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}` });
    }
  }

  // Non-working bands across the range — weekends and project holidays,
  // merged into contiguous runs so e.g. a holiday abutting a weekend paints
  // as one band, not two.
  const holidays = graph.settings.holidays;
  const weekends: TimelineWeekendBand[] = [];
  let bandStart: number | null = null;
  for (let d = 0; d <= span; d++) {
    const date = addDaysIso(rangeStart, d);
    const dow = new Date(utc(date)).getUTCDay();
    const isNonWorking = dow === 0 || dow === 6 || holidays.some((h) => h.start <= date && date <= h.end);
    if (isNonWorking && bandStart === null) bandStart = d;
    if (!isNonWorking && bandStart !== null) {
      weekends.push({ startFrac: bandStart / span, endFrac: d / span });
      bandStart = null;
    }
  }
  if (bandStart !== null) weekends.push({ startFrac: bandStart / span, endFrac: 1 });

  return {
    rows,
    markers,
    ticks,
    weekends,
    rangeStart,
    rangeEnd,
    rangeDays: span,
    empty: false,
    hasUncertainty: p80Date !== null,
  };
}

/** The calendar date at a fraction across `model`'s range — the inverse of
 *  the internal `frac()` used to place rows/markers. For the view's hover
 *  crosshair: pixel under the cursor → fraction → date. */
export function dateAtFrac(model: TimelineModel, frac: number): string {
  const span = Math.max(1, daysBetween(model.rangeStart, model.rangeEnd));
  return addDaysIso(model.rangeStart, Math.round(frac * span));
}
