/**
 * Forward, resource-constrained scheduler over the delivery plan (the
 * group tree), pure. It answers "when does each delivery group start and
 * finish, and when does the project land?".
 *
 * Scheduling units = the topmost groups with an own `durationEstimate`
 * (the rollup/scheduling-unit rule): such a group is atomic and its
 * subtree is not descended into. Units are placed in dependency order
 * (reusing `analysis.ts`) onto tracks. Capacity is one track per
 * `settings.resources` entry (an empty team is a single full-time track);
 * a unit assigned to a resource (`resourceId`) is pinned to that resource's
 * track, otherwise it takes the earliest-free track. A unit's duration is
 * `durationEstimate / (speedMultiplier × fte)` working days — the track's
 * resource FTE stretches it (fte < 1 ⇒ proportionally longer) — on a
 * skip-weekends calendar anchored at `settings.startDate`.
 *
 * Actuals blend over the projection: a done group (has `actualFinish`)
 * uses its real dates; an in-progress group (has `actualStart`) starts on
 * its real start and projects the remainder; everything else is fully
 * projected — and never dated before `now` (today), so remaining work is
 * not scheduled in the past when `startDate` is already behind us.
 * Dependency cycles are tolerated — when nothing is
 * dependency-ready the lowest sibling-order unit is scheduled anyway, so
 * an SCC drains as a batch and the loop never hangs.
 *
 * `assigned_to` is traceability only and plays no part here.
 */

import type { DateRange, ProjectGraph } from './types.ts';
import { childrenOf, groupRootsOf, parentOf, subtreeIds } from './graph.ts';
import { dependencyAdjacency } from './analysis.ts';
import { toDateOnly } from './time.ts';

export interface ScheduledGroup {
  /** ISO date (yyyy-mm-dd). */
  start: string;
  finish: string;
  /** 'actual' once the group is done; 'planned' while any part is projected. */
  source: 'planned' | 'actual';
  /** True for a scheduling unit; false for a container spanning its units. */
  isUnit: boolean;
  /**
   * The speed multiplier and track FTE that stretched this unit's
   * `durationEstimate` into working days — present only when that combined
   * factor isn't a no-op (≠ 1), i.e. there is something to explain about why
   * the bar spans more (or fewer) days than the raw estimate alone implies.
   * Absent for done units (real dates, nothing projected) and for containers.
   */
  stretch?: { speedMultiplier: number; fte: number };
}

export interface Schedule {
  /** Every scheduled group: units by their own dates, containers by span. */
  groups: Map<string, ScheduledGroup>;
  projectStart: string | null;
  projectFinish: string | null;
  /**
   * The dependency critical path to `projectFinish`: the chain of units,
   * earliest → last-finishing, where each is gated by the previous one's
   * finish (a binding prerequisite). It explains *why* the project lands
   * when it does. Anchored where the chain stops depending — a done /
   * in-progress unit's real start, or a unit limited by capacity/`now`
   * rather than a dependency (then the chain is just that final unit).
   */
  criticalPath: string[];
}

/* --------------------------- working calendar --------------------------- */

const DAY_MS = 86_400_000;

function isoToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}
function dateToIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}
function addCalendarDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * DAY_MS);
}
/** True when `iso` falls within any of `ranges` (inclusive both ends). */
function inRanges(iso: string, ranges: readonly DateRange[]): boolean {
  return ranges.some((r) => r.start <= iso && iso <= r.end);
}

/** A skip-weekends-and-holidays calendar: working-day offsets ⇄ ISO dates.
 *  Holidays are project-wide, so they're baked into every track's shared
 *  day sequence (unlike a resource's individual `leave` — see
 *  `spendWorkingDays`/`skipLeave` below, applied per-track on top of this). */
function makeCalendar(startIso: string, holidays: readonly DateRange[]) {
  const isNonWorking = (date: Date): boolean => isWeekend(date) || inRanges(dateToIso(date), holidays);
  let anchor = isoToDate(startIso);
  while (isNonWorking(anchor)) anchor = addCalendarDays(anchor, 1);
  const days: Date[] = [anchor]; // days[i] = date at working-day offset i

  function dateAt(index: number): Date {
    const i = Math.max(0, Math.floor(index));
    while (days.length <= i) {
      let next = addCalendarDays(days[days.length - 1]!, 1);
      while (isNonWorking(next)) next = addCalendarDays(next, 1);
      days.push(next);
    }
    return days[i]!;
  }

  return {
    /** ISO date at a working-day offset (floored, clamped to ≥ 0). */
    isoAt: (index: number): string => dateToIso(dateAt(index)),
    /** Working-day offset of an ISO date (snapped forward; ≥ 0). */
    offsetOf: (iso: string): number => {
      let target = isoToDate(iso);
      while (isNonWorking(target)) target = addCalendarDays(target, 1);
      if (target.getTime() <= anchor.getTime()) return 0;
      let i = 0;
      while (dateAt(i).getTime() < target.getTime()) i++;
      return i;
    },
  };
}

type Calendar = ReturnType<typeof makeCalendar>;

/** Next working-day index at/after `idx` that isn't in `leave`. */
function skipLeave(cal: Calendar, idx: number, leave: readonly DateRange[]): number {
  let i = idx;
  while (inRanges(cal.isoAt(i), leave)) i++;
  return i;
}

/**
 * The working-day index reached after spending `spanDays` days starting at
 * `startIdx` (inclusive), passing over — but not counting — any day that
 * falls in `leave`. Unlike `skipLeave`, this never moves the start itself
 * (used for in-progress units, whose actual start already happened).
 */
function spendWorkingDays(
  cal: Calendar,
  startIdx: number,
  spanDays: number,
  leave: readonly DateRange[],
): number {
  if (leave.length === 0) return startIdx + spanDays - 1;
  let idx = startIdx;
  let counted = inRanges(cal.isoAt(idx), leave) ? 0 : 1;
  while (counted < spanDays) {
    idx++;
    if (!inRanges(cal.isoAt(idx), leave)) counted++;
  }
  return idx;
}

/** Working-day index of the last day a unit spans (start offset + duration). */
function finishIndex(startOffset: number, duration: number): number {
  return Math.max(Math.floor(startOffset), Math.ceil(startOffset + duration) - 1);
}

/* --------------------------- scheduling units --------------------------- */

/** Topmost groups with an own duration estimate, in group pre-order. */
export function schedulingUnits(graph: ProjectGraph): string[] {
  const units: string[] = [];
  const visit = (id: string): void => {
    const node = graph.nodes[id];
    if (!node || node.type !== 'group') return;
    if (node.durationEstimate !== null) {
      units.push(id);
      return; // atomic: do not descend
    }
    for (const child of childrenOf(graph, id)) visit(child);
  };
  for (const root of groupRootsOf(graph)) visit(root);
  return units;
}

/** Pre-order index of every group — the sibling-order tiebreak. */
function groupPreOrder(graph: ProjectGraph): Map<string, number> {
  const order = new Map<string, number>();
  let i = 0;
  const visit = (id: string): void => {
    if (graph.nodes[id]?.type !== 'group') return;
    order.set(id, i++);
    for (const child of childrenOf(graph, id)) visit(child);
  };
  for (const root of groupRootsOf(graph)) visit(root);
  return order;
}

/** Nearest ancestor-or-self that is a scheduling unit, if any. */
function enclosingUnit(
  graph: ProjectGraph,
  id: string,
  unitSet: Set<string>,
): string | null {
  let cur: string | null = id;
  while (cur !== null) {
    if (unitSet.has(cur)) return cur;
    cur = parentOf(graph, cur);
  }
  return null;
}

/**
 * The scheduling units a dependency endpoint resolves to: its enclosing
 * unit if it sits inside one, else every unit in its subtree (a container
 * dependency fans out to the units it covers).
 */
function unitsFor(
  graph: ProjectGraph,
  id: string,
  unitSet: Set<string>,
): string[] {
  const enclosing = enclosingUnit(graph, id, unitSet);
  if (enclosing !== null) return [enclosing];
  return [...subtreeIds(graph, id)].filter((n) => unitSet.has(n));
}

/* ------------------------------ the schedule ---------------------------- */

export function scheduleProject(
  graph: ProjectGraph,
  /** "Today" — projected (not-started) work is never dated before this.
   *  Defaults to `startDate` (a no-op clamp) so pure callers stay
   *  deterministic; the app passes the real current date. */
  now: string = graph.settings.startDate,
): Schedule {
  const { settings } = graph;
  const units = schedulingUnits(graph);
  const unitSet = new Set(units);
  const cal = makeCalendar(settings.startDate, settings.holidays);
  const nowOffset = cal.offsetOf(now);
  const pre = groupPreOrder(graph);

  // Unit-level prerequisites, expanded from the raw group dependency graph.
  const adjacency = dependencyAdjacency(graph);
  const unitPrereqs = new Map<string, Set<string>>();
  for (const u of units) unitPrereqs.set(u, new Set());
  for (const [node, prereqs] of adjacency) {
    if (graph.nodes[node]?.type !== 'group') continue;
    const dependents = unitsFor(graph, node, unitSet);
    for (const prereq of prereqs) {
      if (graph.nodes[prereq]?.type !== 'group') continue;
      for (const pu of unitsFor(graph, prereq, unitSet)) {
        for (const du of dependents) {
          if (du !== pu) unitPrereqs.get(du)!.add(pu);
        }
      }
    }
  }

  const speed = settings.speedMultiplier > 0 ? settings.speedMultiplier : 1;
  // Capacity is one track per resource; an empty team is a single full-time
  // track. Each track carries its resource's FTE (stretches its durations),
  // and assigned units pin to their resource's track.
  const resources = settings.resources;
  const trackFte = resources.length > 0 ? resources.map((r) => (r.fte > 0 ? r.fte : 1)) : [1];
  // Each track's individual leave, on top of the shared holiday calendar —
  // an unassigned unit still lands on *some* resource's track, so this
  // applies regardless of whether the unit was explicitly pinned.
  const trackLeave: DateRange[][] = resources.length > 0 ? resources.map((r) => r.leave) : [[]];
  const resourceTrack = new Map<string, number>();
  resources.forEach((r, i) => resourceTrack.set(r.id, i));
  const tracks = new Array<number>(trackFte.length).fill(0); // free working-day offset
  const finishOffset = new Map<string, number>(); // exclusive: next free day
  const startOffset = new Map<string, number>(); // where each unit begins
  const groups = new Map<string, ScheduledGroup>();

  const remaining = new Set(units);
  while (remaining.size > 0) {
    let ready = [...remaining].filter((u) => {
      for (const p of unitPrereqs.get(u)!) if (remaining.has(p)) return false;
      return true;
    });
    // Dependency cycle: nothing is ready — proceed by sibling order anyway.
    if (ready.length === 0) ready = [...remaining];
    ready.sort((a, b) => (pre.get(a) ?? 0) - (pre.get(b) ?? 0));
    const u = ready[0]!;
    remaining.delete(u);

    const node = graph.nodes[u]!;

    // Track: pinned to the assigned resource when it maps to one, else the
    // earliest-free track (any resource may pick up unassigned work).
    const pinned = node.resourceId !== null ? resourceTrack.get(node.resourceId) : undefined;
    let track: number;
    if (pinned !== undefined) {
      track = pinned;
    } else {
      track = 0;
      for (let k = 1; k < tracks.length; k++) if (tracks[k]! < tracks[track]!) track = k;
    }
    // The track's FTE stretches the projected duration (fte < 1 ⇒ longer).
    const fte = trackFte[track]!;
    const duration = (node.durationEstimate ?? 0) / (speed * fte);
    // Surfaced on the schedule so a view can explain a longer-than-estimate
    // span; omitted when there's nothing to explain (a 1× no-op).
    const stretch = speed * fte !== 1 ? { speedMultiplier: speed, fte } : undefined;

    let prereqFinish = 0;
    for (const p of unitPrereqs.get(u)!) {
      const f = finishOffset.get(p);
      if (f !== undefined) prereqFinish = Math.max(prereqFinish, f);
    }

    if (node.actualFinish !== null) {
      // Done: real dates win; a past unit frees no future capacity.
      // finishOffset is exclusive (the next free day) so a dependent
      // starts the working day *after* the actual finish. The scheduler is
      // day-granular — any time-of-day on the actual is dropped here.
      const finish = toDateOnly(node.actualFinish);
      const start = toDateOnly(node.actualStart ?? node.actualFinish);
      groups.set(u, { start, finish, source: 'actual', isUnit: true });
      startOffset.set(u, cal.offsetOf(start));
      finishOffset.set(u, cal.offsetOf(finish) + 1);
    } else if (node.actualStart !== null) {
      // In progress: real start (never moved — it already happened),
      // projected remainder. A leave-affected track spends whole working
      // days only, skipping over any that fall in the resource's leave.
      const start = toDateOnly(node.actualStart);
      const startOff = cal.offsetOf(start);
      const leave = trackLeave[track]!;
      const naiveFinishIdx = finishIndex(startOff, duration);
      const finishIdx =
        leave.length === 0
          ? naiveFinishIdx
          : spendWorkingDays(cal, startOff, naiveFinishIdx - Math.floor(startOff) + 1, leave);
      const finishOff = leave.length === 0 ? startOff + duration : finishIdx + 1;
      groups.set(u, {
        start,
        finish: cal.isoAt(finishIdx),
        source: 'planned',
        isUnit: true,
        ...(stretch ? { stretch } : {}),
      });
      startOffset.set(u, startOff);
      finishOffset.set(u, finishOff);
      tracks[track] = finishOff;
    } else {
      // Not started: earliest of a free track and its prerequisites, but
      // never before today — future work cannot be dated in the past
      // (which understated the projection when startDate is behind us).
      // A leave-affected track additionally pushes the start itself past
      // any leave (the resource genuinely can't begin that day), then
      // spends only whole working days for the projected span.
      const naiveStartOff = Math.max(tracks[track]!, prereqFinish, nowOffset);
      const leave = trackLeave[track]!;
      const naiveFinishIdx = finishIndex(naiveStartOff, duration);
      let startOff = naiveStartOff;
      let finishIdx = naiveFinishIdx;
      if (leave.length > 0) {
        const spanDays = naiveFinishIdx - Math.floor(naiveStartOff) + 1;
        startOff = skipLeave(cal, Math.floor(naiveStartOff), leave);
        finishIdx = spendWorkingDays(cal, startOff, spanDays, leave);
      }
      const finishOff = leave.length === 0 ? naiveStartOff + duration : finishIdx + 1;
      groups.set(u, {
        start: cal.isoAt(Math.floor(startOff)),
        finish: cal.isoAt(finishIdx),
        source: 'planned',
        isUnit: true,
        ...(stretch ? { stretch } : {}),
      });
      startOffset.set(u, startOff);
      finishOffset.set(u, finishOff);
      tracks[track] = finishOff;
    }
  }

  // Container groups: span the units in their subtree.
  for (const id of pre.keys()) {
    if (groups.has(id)) continue;
    const subUnits = [...subtreeIds(graph, id)].filter((n) => unitSet.has(n));
    if (subUnits.length === 0) continue;
    let start = groups.get(subUnits[0]!)!.start;
    let finish = groups.get(subUnits[0]!)!.finish;
    let allActual = true;
    for (const su of subUnits) {
      const s = groups.get(su)!;
      if (s.start < start) start = s.start;
      if (s.finish > finish) finish = s.finish;
      if (s.source !== 'actual') allActual = false;
    }
    groups.set(id, { start, finish, source: allActual ? 'actual' : 'planned', isUnit: false });
  }

  let projectStart: string | null = null;
  let projectFinish: string | null = null;
  let last: string | null = null;
  for (const u of units) {
    const s = groups.get(u);
    if (!s) continue;
    if (projectStart === null || s.start < projectStart) projectStart = s.start;
    // Latest finish is the critical-path endpoint; ties keep the earlier
    // pre-order unit (units is in pre-order) for determinism.
    if (projectFinish === null || s.finish > projectFinish) {
      projectFinish = s.finish;
      last = u;
    }
  }

  // Walk back from the last-finishing unit through binding prerequisites:
  // the prereq whose finish set this unit's start. Stop when the unit is
  // anchored on a real start (done / in progress) or was limited by
  // capacity/`now` rather than a dependency.
  const criticalPath: string[] = [];
  const seen = new Set<string>();
  let cur = last;
  while (cur !== null && !seen.has(cur)) {
    criticalPath.push(cur);
    seen.add(cur);
    if (graph.nodes[cur]!.actualStart !== null) break; // anchored on real start
    const start = startOffset.get(cur);
    let binding: string | null = null;
    for (const p of unitPrereqs.get(cur)!) {
      if (finishOffset.get(p) === start) {
        // Prefer the highest-pre-order-stable prereq; any exact match is
        // a genuine gater, so the first found is fine.
        binding = p;
        break;
      }
    }
    cur = binding;
  }
  criticalPath.reverse();

  return { groups, projectStart, projectFinish, criticalPath };
}
