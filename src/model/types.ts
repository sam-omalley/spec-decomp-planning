/**
 * Core data model. The entire application state is a single graph of
 * nodes and typed edges. Nodes have two sides:
 *
 * - work nodes (requirement, feature, task, …) — the inputs. They form
 *   the spec tree via 'contains'.
 * - group nodes — the outputs. They form the delivery tree via
 *   'contains' (blocks of epics, epics of sub-epics, any depth).
 *
 * The only bridge between the sides is 'assigned_to': a work node is
 * assigned to at most one group, at any depth. Every view is a
 * projection of this graph.
 */

export type NodeType =
  | 'requirement'
  | 'feature'
  | 'capability'
  | 'component'
  | 'user_story'
  | 'task'
  | 'research'
  | 'bug'
  | 'group';

export type EdgeType =
  | 'contains'
  | 'depends_on'
  | 'implements'
  | 'assigned_to'
  | 'blocks'
  | 'duplicates'
  | 'related_to';

export type Status = 'not_started' | 'in_progress' | 'blocked' | 'done';

export type Priority = 'low' | 'medium' | 'high' | 'critical';

/**
 * A pointer into an external tracker: Jira, GitHub, or any URL. Deliberately
 * generic — `system` is free text so new trackers need no model change.
 * Identity for dedupe/removal is the (system, key) pair.
 */
export interface ExternalRef {
  system: string;
  key: string;
  url?: string;
}

export interface WorkNode {
  id: string;
  title: string;
  description: string;
  type: NodeType;
  status: Status;
  priority: Priority;
  /** Estimated size in abstract points; null = unestimated. */
  effort: number | null;
  /**
   * Estimated duration in working days (the scheduler's canonical unit;
   * hours are a display convenience via `ProjectSettings.hoursPerWeek`).
   * A distinct axis from `effort` — size and time are estimated apart,
   * convertible via `pointsPerDay`. null = unestimated.
   */
  durationEstimate: number | null;
  /**
   * Optimistic/pessimistic bounds (working days) for `durationEstimate`,
   * for the sampled projection (#133) — "3 days if the vendor API
   * behaves, 10 if it doesn't". Both null (the default) means "as certain
   * as today"; a range is only used when **both** are set (either alone
   * is ignored). Without an explicit range, `uncertainty.ts` derives one
   * from this project's own historical estimate accuracy instead, so
   * entering these is optional, not required, to get a calibrated P50/P80.
   */
  durationOptimistic: number | null;
  durationPessimistic: number | null;
  /**
   * Actual start: an ISO date (`YYYY-MM-DD`, no time entered — reads as
   * 00:00) or an ISO datetime-local value (`YYYY-MM-DDTHH:MM`); null if not
   * started. The scheduler only ever reads the date part (day-granular);
   * elapsed-duration metrics (est. vs actual) use the full timestamp.
   */
  actualStart: string | null;
  /** Actual finish — same format as `actualStart`; null if unfinished. */
  actualFinish: string | null;
  /**
   * The `Resource` (team member) this item is assigned to; null = unassigned.
   * Only meaningful on group nodes (the plan side) — it pins the scheduling
   * unit to that resource's track and applies its FTE. References an id in
   * `ProjectSettings.resources`; a dangling id is treated as unassigned.
   */
  resourceId: string | null;
  /** External-tracker pointers (Jira, GitHub, …). Allowed on groups too. */
  externalRefs: ExternalRef[];
  /**
   * A parking-lot group (#155) holds work deliberately kept out of
   * scheduling: it and its whole subtree are excluded from scheduling
   * units (so absent from the Timeline and the Dependency graph) and from
   * `analyzeConcerns`, but still appear in the Map graph and still count
   * toward spec coverage — `assigned_to` and the coverage tags don't care
   * whether the target group is scheduled. Only meaningful on group nodes.
   */
  parkingLot: boolean;
  tags: string[];
  notes: string;
  createdAt: string;
  modifiedAt: string;
}

/** How a dependency edge constrains its dependent's start (#132): 'FS'
 *  (finish-to-start, the default) gates on the prerequisite's finish; 'SS'
 *  (start-to-start) gates on its start instead — the common "runs alongside,
 *  N days behind" shape. Combines with `lagDays`. */
export type DepKind = 'FS' | 'SS';

export interface Edge {
  id: string;
  type: EdgeType;
  /** Source. For 'contains': the parent. For 'assigned_to': the work node. */
  from: string;
  /** Target. For 'contains': the child. For 'assigned_to': the group. */
  to: string;
  /** Sibling sort position; only meaningful on 'contains' edges. */
  order?: number;
  /** Only meaningful on 'depends_on'/'blocks' edges; absent = 'FS'. */
  depKind?: DepKind;
  /** Working days added after the constraint point before the dependent may
   *  start; only meaningful on 'depends_on'/'blocks' edges. Negative = lead
   *  (overlap) — absent/0 is today's zero-lag behaviour. */
  lagDays?: number;
}

/** A closed date range (ISO `YYYY-MM-DD`, inclusive both ends) — a project
 *  holiday or a resource's leave. */
export interface DateRange {
  start: string;
  end: string;
}

/**
 * A team member the plan can be resourced against. Capacity is expressed as
 * a set of resources (replacing the old anonymous `parallelTracks` count):
 * each resource is one scheduling track, and its `fte` scales throughput —
 * a 0.8-FTE resource takes its work `1 / 0.8` longer. A group assigned to a
 * resource (`WorkNode.resourceId`) is pinned to that track. Lives inside
 * `ProjectSettings` so it rides the store/undo/serialize path unchanged.
 */
export interface Resource {
  id: string;
  name: string;
  /** Full-time-equivalent capacity (> 0; 1 = full time, 0.8 = four days). */
  fte: number;
  /** Individual time off; only removes capacity from this resource's own
   *  scheduling track (see `scheduleProject` in `schedule.ts`). */
  leave: DateRange[];
}

/**
 * A named snapshot of the graph, captured for baseline-vs-current drift
 * comparison (`src/model/baselineDrift.ts`). Carries just enough to re-run
 * the scheduler (`scheduleProject`) against the moment it was captured:
 * nodes/edges/root orders are stored by reference (mutations never touch
 * old records, so this is free — same structural-sharing rule as undo).
 * `settings` deliberately excludes `baselines` itself: a baseline's own
 * settings can never need to carry ITS baselines, which would otherwise
 * nest without bound as more snapshots are captured over a project's life.
 */
export interface Baseline {
  id: string;
  label: string;
  /** ISO datetime the snapshot was captured — an audit timestamp only. */
  capturedAt: string;
  /**
   * The project-time "today" (ISO date) in effect when captured — the
   * scheduler's `now` floor to use when re-running *this baseline's own*
   * projection. Distinct from `capturedAt`: that's a real wall-clock
   * timestamp, while `settings.startDate` (and the day a not-yet-started
   * unit can't be scheduled before) lives on the project's own timeline.
   * Re-deriving the baseline's schedule with *today's* real date instead
   * would float every one of its still-projected units forward to whenever
   * it's later viewed, corrupting the very comparison a baseline exists
   * for. Reconstruct with `graphOfBaseline` (`baselineDrift.ts`) and
   * schedule with this as `now`, never `capturedAt`.
   */
  asOfDate: string;
  graph: {
    nodes: Record<string, WorkNode>;
    edges: Record<string, Edge>;
    rootOrder: string[];
    groupRootOrder: string[];
    settings: Omit<ProjectSettings, 'baselines'>;
  };
}

/**
 * Project-scoped scheduling configuration. Lives inside the graph so it
 * rides the existing store/undo/serialize/autosave path unchanged.
 */
export interface ProjectSettings {
  /** Schedule anchor (ISO date); the forward scheduler starts here. */
  startDate: string;
  /** Optional target date for schedule-variance metrics; null = none. */
  targetDate: string | null;
  /** Points↔days conversion factor (points per working day). */
  pointsPerDay: number;
  /** Hours in a working week, for hours↔capacity display (38 by default). */
  hoursPerWeek: number;
  /**
   * The delivery team. Capacity = one track per resource (an empty team
   * falls back to a single full-time track). Replaces `parallelTracks`.
   */
  resources: Resource[];
  /** Capacity: global per-track speed multiplier (>0; scales durations). */
  speedMultiplier: number;
  /** Project-wide non-working dates (public holidays, office closures) —
   *  affect every track, unlike a `Resource`'s individual `leave`. */
  holidays: DateRange[];
  /**
   * Editing lock: how many top levels of the spec tree are frozen against
   * accidental edits (0 = unlocked). Roots are depth 0, so a value of N
   * freezes depths 0…N-1. UI-level only — it gates the editing affordances,
   * it is not a graph invariant, so import/undo/programmatic paths ignore it.
   */
  specLockDepth: number;
  /** Editing lock for the plan (group) tree; see specLockDepth. */
  planLockDepth: number;
  /** Named snapshots for drift comparison; see `Baseline`. */
  baselines: Baseline[];
}

export interface ProjectGraph {
  nodes: Record<string, WorkNode>;
  edges: Record<string, Edge>;
  /** Scheduling configuration; see ProjectSettings. */
  settings: ProjectSettings;
  /**
   * Display order of the spec-tree roots (parentless work nodes).
   * Roots have no 'contains' edge to carry an `order`, so it lives here.
   * Maintained by every mutation; always exactly the set of work roots.
   */
  rootOrder: string[];
  /** Same, for the delivery tree: parentless group nodes. */
  groupRootOrder: string[];
}
