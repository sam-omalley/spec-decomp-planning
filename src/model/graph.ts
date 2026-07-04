/**
 * Pure functions over ProjectGraph. All mutations are immutable: they
 * return a new graph that structurally shares unchanged parts, which is
 * what makes snapshot-based undo/redo cheap.
 *
 * Invariants enforced here:
 * - 'contains' forms a forest: every node has at most one parent, no
 *   cycles, and epics never participate (epics group work via
 *   'belongs_to_epic' edges only, so planning never mutates the tree).
 * - 'belongs_to_epic' points from a non-epic node to an epic node.
 * - No duplicate edge of the same (type, from, to).
 * - Dependency cycles ('depends_on', 'blocks') are deliberately allowed;
 *   they are detected and visualized, not forbidden.
 */

import type {
  Edge,
  EdgeType,
  Plan,
  Priority,
  ProjectGraph,
  Status,
  WorkNode,
} from './types.ts';

export class GraphError extends Error {}

export function createId(): string {
  return crypto.randomUUID();
}

export function emptyGraph(): ProjectGraph {
  return { nodes: {}, edges: {}, plans: {}, rootOrder: [] };
}

function nowIso(): string {
  return new Date().toISOString();
}

function requireNode(graph: ProjectGraph, id: string): WorkNode {
  const node = graph.nodes[id];
  if (!node) throw new GraphError(`Node not found: ${id}`);
  return node;
}

function withoutRoot(graph: ProjectGraph, id: string): ProjectGraph {
  if (!graph.rootOrder.includes(id)) return graph;
  return { ...graph, rootOrder: graph.rootOrder.filter((r) => r !== id) };
}

function withRootAppended(graph: ProjectGraph, id: string): ProjectGraph {
  if (graph.rootOrder.includes(id)) return graph;
  return { ...graph, rootOrder: [...graph.rootOrder, id] };
}

/** Repositions `id` within rootOrder (it must already be a root). */
function setRootIndex(graph: ProjectGraph, id: string, index: number): ProjectGraph {
  const others = graph.rootOrder.filter((r) => r !== id);
  const clamped = Math.max(0, Math.min(index, others.length));
  others.splice(clamped, 0, id);
  return { ...graph, rootOrder: others };
}

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

/** The 'contains' edge whose child is `id`, if any. */
export function parentEdgeOf(graph: ProjectGraph, id: string): Edge | undefined {
  for (const edge of Object.values(graph.edges)) {
    if (edge.type === 'contains' && edge.to === id) return edge;
  }
  return undefined;
}

export function parentOf(graph: ProjectGraph, id: string): string | null {
  return parentEdgeOf(graph, id)?.from ?? null;
}

/** Child ids of `id`, in sibling order. */
export function childrenOf(graph: ProjectGraph, id: string): string[] {
  return Object.values(graph.edges)
    .filter((e) => e.type === 'contains' && e.from === id)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((e) => e.to);
}

/** The spec-tree roots (parentless non-epic nodes), in display order. */
export function rootsOf(graph: ProjectGraph): string[] {
  return [...graph.rootOrder];
}

/** `id` plus all its descendants via 'contains'. */
export function subtreeIds(graph: ProjectGraph, id: string): Set<string> {
  requireNode(graph, id);
  const result = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (result.has(current)) continue;
    result.add(current);
    stack.push(...childrenOf(graph, current));
  }
  return result;
}

/** True if `maybeAncestor` is `id` itself or a 'contains' ancestor of it. */
export function isInSubtreeOf(
  graph: ProjectGraph,
  id: string,
  maybeAncestor: string,
): boolean {
  let current: string | null = id;
  while (current !== null) {
    if (current === maybeAncestor) return true;
    current = parentOf(graph, current);
  }
  return false;
}

export function epicsOfPlan(graph: ProjectGraph, planId: string): string[] {
  return Object.values(graph.nodes)
    .filter((n) => n.type === 'epic' && n.planId === planId)
    .map((n) => n.id);
}

/** Ids of nodes that belong to the given epic. */
export function membersOfEpic(graph: ProjectGraph, epicId: string): string[] {
  return Object.values(graph.edges)
    .filter((e) => e.type === 'belongs_to_epic' && e.to === epicId)
    .map((e) => e.from);
}

/** Ids of epics the given node belongs to (across all plans). */
export function epicsOfNode(graph: ProjectGraph, nodeId: string): string[] {
  return Object.values(graph.edges)
    .filter((e) => e.type === 'belongs_to_epic' && e.from === nodeId)
    .map((e) => e.to);
}

export function edgeBetween(
  graph: ProjectGraph,
  type: EdgeType,
  from: string,
  to: string,
): Edge | undefined {
  return Object.values(graph.edges).find(
    (e) => e.type === type && e.from === from && e.to === to,
  );
}

/* ------------------------------------------------------------------ */
/* Node mutations                                                      */
/* ------------------------------------------------------------------ */

export interface NodeInput {
  id: string;
  title: string;
  description?: string;
  type?: Exclude<WorkNode['type'], 'epic'>;
  status?: Status;
  priority?: Priority;
  effort?: number | null;
  tags?: string[];
  notes?: string;
  createdAt?: string;
}

export function createNode(
  graph: ProjectGraph,
  input: NodeInput,
  parentId?: string,
): ProjectGraph {
  if (graph.nodes[input.id]) {
    throw new GraphError(`Node id already exists: ${input.id}`);
  }
  const timestamp = input.createdAt ?? nowIso();
  const node: WorkNode = {
    id: input.id,
    title: input.title,
    description: input.description ?? '',
    type: input.type ?? 'task',
    status: input.status ?? 'not_started',
    priority: input.priority ?? 'medium',
    effort: input.effort ?? null,
    tags: input.tags ?? [],
    notes: input.notes ?? '',
    createdAt: timestamp,
    modifiedAt: timestamp,
  };
  let next: ProjectGraph = {
    ...graph,
    nodes: { ...graph.nodes, [node.id]: node },
  };
  if (parentId === undefined) {
    next = withRootAppended(next, node.id);
  } else {
    next = addEdge(next, { type: 'contains', from: parentId, to: node.id });
  }
  return next;
}

export type NodePatch = Partial<
  Omit<WorkNode, 'id' | 'type' | 'planId' | 'createdAt' | 'modifiedAt'>
>;

export function updateNode(
  graph: ProjectGraph,
  id: string,
  patch: NodePatch,
): ProjectGraph {
  const node = requireNode(graph, id);
  const updated: WorkNode = { ...node, ...patch, modifiedAt: nowIso() };
  return { ...graph, nodes: { ...graph.nodes, [id]: updated } };
}

/**
 * Deletes `id` and its entire 'contains' subtree, plus every edge that
 * touches a removed node (dependencies, epic memberships, everything).
 */
export function deleteNode(graph: ProjectGraph, id: string): ProjectGraph {
  const removed = subtreeIds(graph, id);
  const nodes: Record<string, WorkNode> = {};
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (!removed.has(nodeId)) nodes[nodeId] = node;
  }
  const edges: Record<string, Edge> = {};
  for (const [edgeId, edge] of Object.entries(graph.edges)) {
    if (!removed.has(edge.from) && !removed.has(edge.to)) edges[edgeId] = edge;
  }
  const rootOrder = graph.rootOrder.filter((id) => !removed.has(id));
  return { ...graph, nodes, edges, rootOrder };
}

/**
 * Reparents `id` under `newParentId` (or to root level when null),
 * optionally at a specific sibling index — for roots the index is a
 * position in `rootOrder`. Planning data is untouched by design.
 */
export function moveNode(
  graph: ProjectGraph,
  id: string,
  newParentId: string | null,
  index?: number,
): ProjectGraph {
  requireNode(graph, id);
  let next = graph;
  const existing = parentEdgeOf(next, id);
  if (existing) next = removeEdge(next, existing.id);

  if (newParentId !== null) {
    next = addEdge(next, { type: 'contains', from: newParentId, to: id });
    if (index !== undefined) next = setChildIndex(next, newParentId, id, index);
  } else if (index !== undefined) {
    next = setRootIndex(next, id, index);
  }
  return next;
}

/** Renumber the children of `parentId` so `childId` sits at `index`. */
function setChildIndex(
  graph: ProjectGraph,
  parentId: string,
  childId: string,
  index: number,
): ProjectGraph {
  const siblings = childrenOf(graph, parentId).filter((c) => c !== childId);
  const clamped = Math.max(0, Math.min(index, siblings.length));
  siblings.splice(clamped, 0, childId);

  const edges = { ...graph.edges };
  for (const [edgeId, edge] of Object.entries(edges)) {
    if (edge.type === 'contains' && edge.from === parentId) {
      const order = siblings.indexOf(edge.to);
      if (order !== (edge.order ?? 0)) {
        edges[edgeId] = { ...edge, order };
      }
    }
  }
  return { ...graph, edges };
}

/* ------------------------------------------------------------------ */
/* Edge mutations                                                      */
/* ------------------------------------------------------------------ */

export interface EdgeInput {
  id?: string;
  type: EdgeType;
  from: string;
  to: string;
}

export function addEdge(graph: ProjectGraph, input: EdgeInput): ProjectGraph {
  const from = requireNode(graph, input.from);
  const to = requireNode(graph, input.to);
  if (input.from === input.to) {
    throw new GraphError('An edge cannot connect a node to itself');
  }
  if (edgeBetween(graph, input.type, input.from, input.to)) {
    throw new GraphError(
      `Duplicate edge: ${input.from} -[${input.type}]-> ${input.to}`,
    );
  }

  let order: number | undefined;
  if (input.type === 'contains') {
    if (from.type === 'epic' || to.type === 'epic') {
      throw new GraphError(
        "Epics cannot participate in 'contains'; use 'belongs_to_epic'",
      );
    }
    if (parentEdgeOf(graph, input.to)) {
      throw new GraphError(
        `Node ${input.to} already has a parent (single-parent decomposition)`,
      );
    }
    if (isInSubtreeOf(graph, input.from, input.to)) {
      throw new GraphError("Refusing to create a 'contains' cycle");
    }
    const siblings = childrenOf(graph, input.from);
    order = siblings.length;
  }

  if (input.type === 'belongs_to_epic') {
    if (to.type !== 'epic') {
      throw new GraphError(`Target of 'belongs_to_epic' must be an epic: ${to.id}`);
    }
    if (from.type === 'epic') {
      throw new GraphError('An epic cannot belong to another epic');
    }
  }

  const edge: Edge = {
    id: input.id ?? createId(),
    type: input.type,
    from: input.from,
    to: input.to,
    ...(order !== undefined ? { order } : {}),
  };
  let next: ProjectGraph = { ...graph, edges: { ...graph.edges, [edge.id]: edge } };
  // Gaining a parent removes the child from the root order.
  if (edge.type === 'contains') next = withoutRoot(next, edge.to);
  return next;
}

export function removeEdge(graph: ProjectGraph, edgeId: string): ProjectGraph {
  const edge = graph.edges[edgeId];
  if (!edge) throw new GraphError(`Edge not found: ${edgeId}`);
  const edges = { ...graph.edges };
  delete edges[edgeId];
  let next: ProjectGraph = { ...graph, edges };
  // Losing its parent makes the child a root.
  if (edge.type === 'contains') next = withRootAppended(next, edge.to);
  return next;
}

/* ------------------------------------------------------------------ */
/* Plans and epics                                                     */
/* ------------------------------------------------------------------ */

export interface PlanInput {
  id: string;
  name: string;
  createdAt?: string;
}

export function createPlan(graph: ProjectGraph, input: PlanInput): ProjectGraph {
  if (graph.plans[input.id]) {
    throw new GraphError(`Plan id already exists: ${input.id}`);
  }
  const plan: Plan = {
    id: input.id,
    name: input.name,
    createdAt: input.createdAt ?? nowIso(),
  };
  return { ...graph, plans: { ...graph.plans, [plan.id]: plan } };
}

export function renamePlan(
  graph: ProjectGraph,
  planId: string,
  name: string,
): ProjectGraph {
  const plan = graph.plans[planId];
  if (!plan) throw new GraphError(`Plan not found: ${planId}`);
  return { ...graph, plans: { ...graph.plans, [planId]: { ...plan, name } } };
}

/**
 * Deletes a plan and all of its epics (and their membership edges).
 * The spec tree and all non-epic nodes are untouched.
 */
export function deletePlan(graph: ProjectGraph, planId: string): ProjectGraph {
  if (!graph.plans[planId]) throw new GraphError(`Plan not found: ${planId}`);
  let next = graph;
  for (const epicId of epicsOfPlan(graph, planId)) {
    next = deleteNode(next, epicId);
  }
  const plans = { ...next.plans };
  delete plans[planId];
  return { ...next, plans };
}

export interface EpicInput {
  id: string;
  title: string;
  description?: string;
  createdAt?: string;
}

export function createEpic(
  graph: ProjectGraph,
  planId: string,
  input: EpicInput,
): ProjectGraph {
  if (!graph.plans[planId]) throw new GraphError(`Plan not found: ${planId}`);
  if (graph.nodes[input.id]) {
    throw new GraphError(`Node id already exists: ${input.id}`);
  }
  const timestamp = input.createdAt ?? nowIso();
  const epic: WorkNode = {
    id: input.id,
    title: input.title,
    description: input.description ?? '',
    type: 'epic',
    status: 'not_started',
    priority: 'medium',
    effort: null,
    tags: [],
    notes: '',
    planId,
    createdAt: timestamp,
    modifiedAt: timestamp,
  };
  return { ...graph, nodes: { ...graph.nodes, [epic.id]: epic } };
}

export function assignToEpic(
  graph: ProjectGraph,
  nodeId: string,
  epicId: string,
): ProjectGraph {
  return addEdge(graph, { type: 'belongs_to_epic', from: nodeId, to: epicId });
}

export function removeFromEpic(
  graph: ProjectGraph,
  nodeId: string,
  epicId: string,
): ProjectGraph {
  const edge = edgeBetween(graph, 'belongs_to_epic', nodeId, epicId);
  if (!edge) {
    throw new GraphError(`Node ${nodeId} is not a member of epic ${epicId}`);
  }
  return removeEdge(graph, edge.id);
}
