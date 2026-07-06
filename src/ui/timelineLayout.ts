/**
 * Pure layout for the timeline / Gantt view. Turns the scheduler's output
 * into positioned rows (fractions in [0,1] across the date range, so the
 * SVG view just multiplies by a pixel width), plus projected-finish and
 * target-date markers and weekly gridline ticks. No pixels here — all
 * geometry is fraction-based and unit-testable.
 */

import type { ProjectGraph } from '../model/types.ts';
import { childrenOf, groupRootsOf } from '../model/graph.ts';
import { scheduleProject } from '../model/schedule.ts';
import { rootGroupColor } from './colors.ts';

export interface TimelineRow {
  id: string;
  title: string;
  depth: number;
  color: string;
  isUnit: boolean;
  source: 'planned' | 'actual';
  start: string;
  finish: string;
  startFrac: number;
  endFrac: number;
}

export interface TimelineMarker {
  frac: number;
  date: string;
  kind: 'finish' | 'target';
}

export interface TimelineTick {
  frac: number;
  label: string;
}

export interface TimelineModel {
  rows: TimelineRow[];
  markers: TimelineMarker[];
  ticks: TimelineTick[];
  rangeStart: string;
  rangeEnd: string;
  empty: boolean;
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

const EMPTY: TimelineModel = {
  rows: [],
  markers: [],
  ticks: [],
  rangeStart: '',
  rangeEnd: '',
  empty: true,
};

export function buildTimeline(graph: ProjectGraph): TimelineModel {
  const schedule = scheduleProject(graph);

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
  }
  const target = graph.settings.targetDate;
  if (target) {
    if (target < rangeStart) rangeStart = target;
    if (target > rangeEnd) rangeEnd = target;
  }

  const span = Math.max(1, daysBetween(rangeStart, rangeEnd));
  const frac = (iso: string): number => {
    const f = daysBetween(rangeStart, iso) / span;
    return f < 0 ? 0 : f > 1 ? 1 : f;
  };

  const rows: TimelineRow[] = scheduled.map(({ id, depth }) => {
    const g = schedule.groups.get(id)!;
    return {
      id,
      title: graph.nodes[id]?.title.trim() || 'Untitled',
      depth,
      color: rootGroupColor(graph, id),
      isUnit: g.isUnit,
      source: g.source,
      start: g.start,
      finish: g.finish,
      startFrac: frac(g.start),
      endFrac: frac(g.finish),
    };
  });

  const markers: TimelineMarker[] = [];
  if (schedule.projectFinish) {
    markers.push({ frac: frac(schedule.projectFinish), date: schedule.projectFinish, kind: 'finish' });
  }
  if (target) markers.push({ frac: frac(target), date: target, kind: 'target' });

  // Weekly gridlines from the first Monday on/after rangeStart.
  const ticks: TimelineTick[] = [];
  const startDow = new Date(utc(rangeStart)).getUTCDay(); // 0=Sun
  const toMonday = (8 - (startDow === 0 ? 7 : startDow)) % 7;
  for (let d = toMonday; d <= span; d += 7) {
    const iso = addDaysIso(rangeStart, d);
    const date = new Date(utc(iso));
    ticks.push({ frac: d / span, label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}` });
  }

  return { rows, markers, ticks, rangeStart, rangeEnd, empty: false };
}
