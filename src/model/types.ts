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

export interface WorkNode {
  id: string;
  title: string;
  description: string;
  type: NodeType;
  status: Status;
  priority: Priority;
  /** Estimated effort in abstract points; null = unestimated. */
  effort: number | null;
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

export interface ProjectGraph {
  nodes: Record<string, WorkNode>;
  edges: Record<string, Edge>;
  /**
   * Display order of the spec-tree roots (parentless work nodes).
   * Roots have no 'contains' edge to carry an `order`, so it lives here.
   * Maintained by every mutation; always exactly the set of work roots.
   */
  rootOrder: string[];
  /** Same, for the delivery tree: parentless group nodes. */
  groupRootOrder: string[];
}
