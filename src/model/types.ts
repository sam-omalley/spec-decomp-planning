/**
 * Core data model. The entire application state is a single graph:
 * nodes (work items), typed edges (relationships), and plans (named
 * scenarios that scope epics). Every view is a projection of this graph.
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
  | 'epic';

export type EdgeType =
  | 'contains'
  | 'depends_on'
  | 'implements'
  | 'belongs_to_epic'
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
  /** Only set on nodes of type 'epic': the plan this epic belongs to. */
  planId?: string;
  createdAt: string;
  modifiedAt: string;
}

export interface Edge {
  id: string;
  type: EdgeType;
  /** Source. For 'contains': the parent. For 'belongs_to_epic': the member. */
  from: string;
  /** Target. For 'contains': the child. For 'belongs_to_epic': the epic. */
  to: string;
  /** Sibling sort position; only meaningful on 'contains' edges. */
  order?: number;
}

/** A named alternative organization of work into epics. */
export interface Plan {
  id: string;
  name: string;
  createdAt: string;
}

export interface ProjectGraph {
  nodes: Record<string, WorkNode>;
  edges: Record<string, Edge>;
  plans: Record<string, Plan>;
}
