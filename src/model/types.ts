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
   * hours are a display convenience via `ProjectSettings.hoursPerDay`).
   * A distinct axis from `effort` — size and time are estimated apart,
   * convertible via `pointsPerDay`. null = unestimated.
   */
  durationEstimate: number | null;
  /** Actual start (ISO date), or null if not started. */
  actualStart: string | null;
  /** Actual finish (ISO date), or null if unfinished. */
  actualFinish: string | null;
  /** External-tracker pointers (Jira, GitHub, …). Allowed on groups too. */
  externalRefs: ExternalRef[];
  tags: string[];
  notes: string;
  createdAt: string;
  modifiedAt: string;
}

export interface Edge {
  id: string;
  type: EdgeType;
  /** Source. For 'contains': the parent. For 'assigned_to': the work node. */
  from: string;
  /** Target. For 'contains': the child. For 'assigned_to': the group. */
  to: string;
  /** Sibling sort position; only meaningful on 'contains' edges. */
  order?: number;
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
  /** Hours per working day, for hours↔days display. */
  hoursPerDay: number;
  /** Capacity: how many work items may run at once (positive integer). */
  parallelTracks: number;
  /** Capacity: global per-track speed multiplier (>0; scales durations). */
  speedMultiplier: number;
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
