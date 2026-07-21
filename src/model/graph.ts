/**
 * Pure functions over ProjectGraph. All mutations are immutable: they
 * return a new graph that structurally shares unchanged parts, which is
 * what makes snapshot-based undo/redo cheap.
 *
 * Invariants enforced here:
 * - 'contains' forms two forests: every node has at most one parent and
 *   no cycles, and containment never crosses sides — work nodes nest in
 *   work nodes (the spec tree), groups nest in groups (the delivery
 *   tree). The bridge between the sides is 'assigned_to' only, so
 *   planning never mutates the spec and vice versa.
 * - 'assigned_to' points from a work node to a group, and each work
 *   node is assigned to at most one group (assignToGroup moves).
 * - No duplicate edge of the same (type, from, to).
 * - Dependency cycles ('depends_on', 'blocks') are deliberately allowed;
 *   they are detected and visualized, not forbidden.
 */

import type {
  DateRange,
  Edge,
  EdgeType,
  ExternalRef,
  Priority,
  ProjectGraph,
  ProjectSettings,
  Resource,
  Status,
  WorkNode,
} from './types.ts';

export class GraphError extends Error {}

export function createId(): string {
  return crypto.randomUUID();
}

/** Today as an ISO date (yyyy-mm-dd), the granularity the scheduler uses. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Neutral defaults for a fresh project (no team, no speed-up, no target). */
export function defaultSettings(): ProjectSettings {
  return {
    startDate: todayIso(),
    targetDate: null,
    pointsPerDay: 1,
    hoursPerWeek: 38,
    resources: [],
    speedMultiplier: 1,
    holidays: [],
    specLockDepth: 0,
    planLockDepth: 0,
  };
}

export function emptyGraph(): ProjectGraph {
  return {
    nodes: {},
    edges: {},
    rootOrder: [],
    groupRootOrder: [],
    settings: defaultSettings(),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function requireNode(graph: ProjectGraph, id: string): WorkNode {
  const node = graph.nodes[id];
  if (!node) throw new GraphError(`Node not found: ${id}`);
  return node;
}

export function isGroup(node: WorkNode): boolean {
  return node.type === 'group';
}

/* ------------------------------------------------------------------ */
/* Root order maintenance (side-aware)                                 */
/* ------------------------------------------------------------------ */

function rootKeyFor(graph: ProjectGraph, id: string): 'rootOrder' | 'groupRootOrder' {
  return graph.nodes[id]?.type === 'group' ? 'groupRootOrder' : 'rootOrder';
}

function withoutRoot(graph: ProjectGraph, id: string): ProjectGraph {
  const key = rootKeyFor(graph, id);
  if (!graph[key].includes(id)) return graph;
  return { ...graph, [key]: graph[key].filter((r) => r !== id) };
}

function withRootAppended(graph: ProjectGraph, id: string): ProjectGraph {
  const key = rootKeyFor(graph, id);
  if (graph[key].includes(id)) return graph;
  return { ...graph, [key]: [...graph[key], id] };
}

/** Repositions `id` within its side's root order (it must be a root). */
function setRootIndex(graph: ProjectGraph, id: string, index: number): ProjectGraph {
  const key = rootKeyFor(graph, id);
  const others = graph[key].filter((r) => r !== id);
  const clamped = Math.max(0, Math.min(index, others.length));
  others.splice(clamped, 0, id);
  return { ...graph, [key]: others };
}

/* ------------------------------------------------------------------ */
/* Edge index (cached per graph reference)                             */
/*                                                                      */
/* The graph is immutable with structural sharing, so a given          */
/* ProjectGraph reference never changes underneath us — a WeakMap      */
/* keyed on that reference is a safe, self-invalidating cache. This    */
/* turns the selectors below from O(E) edge scans into O(1)/O(children)*/
/* lookups without changing their signatures or semantics.             */
/* ------------------------------------------------------------------ */

interface GraphIndex {
  parentByChild: Map<string, Edge>;
  childrenByParent: Map<string, string[]>;
  assignmentByFrom: Map<string, Edge>;
  membersByGroup: Map<string, string[]>;
  edgeByKey: Map<string, Edge>;
}

const indexCache = new WeakMap<ProjectGraph, GraphIndex>();

function edgeKey(type: EdgeType, from: string, to: string): string {
  return `${type}|${from}|${to}`;
}

function buildIndex(graph: ProjectGraph): GraphIndex {
  const parentByChild = new Map<string, Edge>();
  const childrenEdgesByParent = new Map<string, Edge[]>();
  const assignmentByFrom = new Map<string, Edge>();
  const membersByGroup = new Map<string, string[]>();
  const edgeByKey = new Map<string, Edge>();

  for (const edge of Object.values(graph.edges)) {
    edgeByKey.set(edgeKey(edge.type, edge.from, edge.to), edge);
    if (edge.type === 'contains') {
      parentByChild.set(edge.to, edge);
      const siblings = childrenEdgesByParent.get(edge.from);
      if (siblings) siblings.push(edge);
      else childrenEdgesByParent.set(edge.from, [edge]);
    } else if (edge.type === 'assigned_to') {
      assignmentByFrom.set(edge.from, edge);
      const members = membersByGroup.get(edge.to);
      if (members) members.push(edge.from);
      else membersByGroup.set(edge.to, [edge.from]);
    }
  }

  const childrenByParent = new Map<string, string[]>();
  for (const [parentId, edges] of childrenEdgesByParent) {
    edges.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    childrenByParent.set(parentId, Object.freeze(edges.map((e) => e.to)) as string[]);
  }
  // childrenOf/membersOfGroup return these arrays by reference (not a fresh
  // copy) to keep the O(1) win from the cache — freeze them so an accidental
  // in-place mutation (.sort()/.push()/…) on a caller's end throws instead of
  // silently corrupting the index for every later selector call against the
  // same graph reference.
  for (const members of membersByGroup.values()) Object.freeze(members);

  return { parentByChild, childrenByParent, assignmentByFrom, membersByGroup, edgeByKey };
}

function getIndex(graph: ProjectGraph): GraphIndex {
  let index = indexCache.get(graph);
  if (!index) {
    index = buildIndex(graph);
    indexCache.set(graph, index);
  }
  return index;
}

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

/** The 'contains' edge whose child is `id`, if any. */
export function parentEdgeOf(graph: ProjectGraph, id: string): Edge | undefined {
  return getIndex(graph).parentByChild.get(id);
}

export function parentOf(graph: ProjectGraph, id: string): string | null {
  return parentEdgeOf(graph, id)?.from ?? null;
}

/** Child ids of `id`, in sibling order. */
export function childrenOf(graph: ProjectGraph, id: string): string[] {
  return getIndex(graph).childrenByParent.get(id) ?? [];
}

/** The spec-tree roots (parentless work nodes), in display order. */
export function rootsOf(graph: ProjectGraph): string[] {
  return [...graph.rootOrder];
}

/** The delivery-tree roots (parentless group nodes), in display order. */
export function groupRootsOf(graph: ProjectGraph): string[] {
  return [...graph.groupRootOrder];
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
  // A well-formed graph never has a 'contains' cycle (every mutation here
  // rejects one), but a file loaded from disk might if it predates
  // validateGraph's repair pass — a visited set keeps this a wrong answer
  // instead of an infinite loop.
  const visited = new Set<string>();
  while (current !== null && !visited.has(current)) {
    if (current === maybeAncestor) return true;
    visited.add(current);
    current = parentOf(graph, current);
  }
  return false;
}

/** The 'assigned_to' edge of a work node, if any (at most one exists). */
export function assignmentEdgeOf(graph: ProjectGraph, nodeId: string): Edge | undefined {
  return getIndex(graph).assignmentByFrom.get(nodeId);
}

/** The group a work node is directly assigned to, if any. */
export function groupOf(graph: ProjectGraph, nodeId: string): string | null {
  return assignmentEdgeOf(graph, nodeId)?.to ?? null;
}

/** Ids of work nodes directly assigned to the given group. */
export function membersOfGroup(graph: ProjectGraph, groupId: string): string[] {
  return getIndex(graph).membersByGroup.get(groupId) ?? [];
}

export function edgeBetween(
  graph: ProjectGraph,
  type: EdgeType,
  from: string,
  to: string,
): Edge | undefined {
  return getIndex(graph).edgeByKey.get(edgeKey(type, from, to));
}

/* ------------------------------------------------------------------ */
/* Node mutations                                                      */
/* ------------------------------------------------------------------ */

export interface NodeInput {
  id: string;
  title: string;
  description?: string;
  type?: Exclude<WorkNode['type'], 'group'>;
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
    durationEstimate: null,
    actualStart: null,
    actualFinish: null,
    resourceId: null,
    externalRefs: [],
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

export interface GroupInput {
  id: string;
  title: string;
  description?: string;
  createdAt?: string;
}

/** Creates a group node, optionally nested under another group. */
export function createGroup(
  graph: ProjectGraph,
  input: GroupInput,
  parentGroupId?: string,
): ProjectGraph {
  if (graph.nodes[input.id]) {
    throw new GraphError(`Node id already exists: ${input.id}`);
  }
  const timestamp = input.createdAt ?? nowIso();
  const group: WorkNode = {
    id: input.id,
    title: input.title,
    description: input.description ?? '',
    type: 'group',
    status: 'not_started',
    priority: 'medium',
    effort: null,
    durationEstimate: null,
    actualStart: null,
    actualFinish: null,
    resourceId: null,
    externalRefs: [],
    tags: [],
    notes: '',
    createdAt: timestamp,
    modifiedAt: timestamp,
  };
  let next: ProjectGraph = {
    ...graph,
    nodes: { ...graph.nodes, [group.id]: group },
  };
  if (parentGroupId === undefined) {
    next = withRootAppended(next, group.id);
  } else {
    next = addEdge(next, { type: 'contains', from: parentGroupId, to: group.id });
  }
  return next;
}

export type NodePatch = Partial<
  Omit<WorkNode, 'id' | 'type' | 'createdAt' | 'modifiedAt'>
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
 * touches a removed node. Deleting a group subtree removes assignments
 * into it but never the assigned work nodes.
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
  return {
    ...graph,
    nodes,
    edges,
    rootOrder: graph.rootOrder.filter((r) => !removed.has(r)),
    groupRootOrder: graph.groupRootOrder.filter((r) => !removed.has(r)),
  };
}

/**
 * Reparents `id` under `newParentId` (or to root level when null),
 * optionally at a specific sibling index — for roots the index is a
 * position in the side's root order. Works on both sides; assignments
 * are untouched by design.
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
    if (isGroup(from) !== isGroup(to)) {
      throw new GraphError(
        "'contains' cannot cross sides: work nests in work, groups in groups; use 'assigned_to' to bridge",
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

  if (input.type === 'depends_on' || input.type === 'blocks') {
    if (!isGroup(from) || !isGroup(to)) {
      throw new GraphError(
        'Dependencies sequence delivery groups (the plan); spec work nodes are structural only',
      );
    }
  }

  if (input.type === 'assigned_to') {
    if (isGroup(from)) {
      throw new GraphError('Groups cannot be assigned; only work nodes can');
    }
    if (!isGroup(to)) {
      throw new GraphError(`Assignment target must be a group: ${to.id}`);
    }
    const existing = assignmentEdgeOf(graph, input.from);
    if (existing) {
      throw new GraphError(
        `Node ${input.from} is already assigned to ${existing.to}; use assignToGroup to move it`,
      );
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
  // Gaining a parent removes the child from its side's root order.
  if (edge.type === 'contains') next = withoutRoot(next, edge.to);
  return next;
}

export function removeEdge(graph: ProjectGraph, edgeId: string): ProjectGraph {
  const edge = graph.edges[edgeId];
  if (!edge) throw new GraphError(`Edge not found: ${edgeId}`);
  const edges = { ...graph.edges };
  delete edges[edgeId];
  let next: ProjectGraph = { ...graph, edges };
  // Losing its parent makes the child a root of its side.
  if (edge.type === 'contains') next = withRootAppended(next, edge.to);
  return next;
}

/* ------------------------------------------------------------------ */
/* Assignment (work → group)                                           */
/* ------------------------------------------------------------------ */

/**
 * Assigns a work node to a group. If it is already assigned elsewhere,
 * the assignment moves (single membership). Assigning to the current
 * group is a no-op that returns the same graph.
 */
export function assignToGroup(
  graph: ProjectGraph,
  nodeId: string,
  groupId: string,
): ProjectGraph {
  const existing = assignmentEdgeOf(graph, nodeId);
  if (existing?.to === groupId) return graph;
  let next = graph;
  if (existing) next = removeEdge(next, existing.id);
  return addEdge(next, { type: 'assigned_to', from: nodeId, to: groupId });
}

export function removeFromGroup(graph: ProjectGraph, nodeId: string): ProjectGraph {
  const edge = assignmentEdgeOf(graph, nodeId);
  if (!edge) {
    throw new GraphError(`Node ${nodeId} is not assigned to a group`);
  }
  return removeEdge(graph, edge.id);
}

/* ------------------------------------------------------------------ */
/* Estimation, progress & external refs (project-management extension) */
/* ------------------------------------------------------------------ */

function putNode(graph: ProjectGraph, node: WorkNode): ProjectGraph {
  return {
    ...graph,
    nodes: { ...graph.nodes, [node.id]: { ...node, modifiedAt: nowIso() } },
  };
}

function requireNonNegative(value: number | null, label: string): void {
  if (value !== null && !(value >= 0)) {
    throw new GraphError(`${label} cannot be negative`);
  }
}

export interface EstimatePatch {
  /** Size in abstract points. Pass null to clear. Omit to leave as-is. */
  effort?: number | null;
  /** Duration in working days. Pass null to clear. Omit to leave as-is. */
  durationEstimate?: number | null;
}

/** Sets a node's estimate axes independently; either may be omitted. */
export function setEstimate(
  graph: ProjectGraph,
  id: string,
  patch: EstimatePatch,
): ProjectGraph {
  const node = requireNode(graph, id);
  const updated: WorkNode = { ...node };
  if ('effort' in patch) {
    const value = patch.effort ?? null;
    requireNonNegative(value, 'effort');
    updated.effort = value;
  }
  if ('durationEstimate' in patch) {
    const value = patch.durationEstimate ?? null;
    requireNonNegative(value, 'durationEstimate');
    updated.durationEstimate = value;
  }
  return putNode(graph, updated);
}

export interface ActualsPatch {
  /** ISO date or ISO datetime-local (`YYYY-MM-DDTHH:MM`), or null to clear.
   *  Omit to leave as-is. */
  actualStart?: string | null;
  actualFinish?: string | null;
}

/**
 * Sets actual start/finish and auto-derives status:
 * finished ⇒ 'done'; started (not finished) ⇒ 'in_progress', unless the
 * node is manually 'blocked' (a started-then-blocked item stays blocked);
 * neither date set ⇒ status untouched, so manual states survive.
 */
export function setActualDates(
  graph: ProjectGraph,
  id: string,
  patch: ActualsPatch,
): ProjectGraph {
  const node = requireNode(graph, id);
  const updated: WorkNode = { ...node };
  if ('actualStart' in patch) updated.actualStart = patch.actualStart ?? null;
  if ('actualFinish' in patch) updated.actualFinish = patch.actualFinish ?? null;

  if (updated.actualFinish !== null) {
    updated.status = 'done';
  } else if (updated.actualStart !== null) {
    if (updated.status !== 'blocked') updated.status = 'in_progress';
  }
  return putNode(graph, updated);
}

/** Adds an external-tracker pointer; rejects a duplicate (system, key). */
export function addExternalRef(
  graph: ProjectGraph,
  id: string,
  ref: ExternalRef,
): ProjectGraph {
  const node = requireNode(graph, id);
  if (!ref.system.trim() || !ref.key.trim()) {
    throw new GraphError('External ref needs a system and a key');
  }
  if (node.externalRefs.some((r) => r.system === ref.system && r.key === ref.key)) {
    throw new GraphError(`Duplicate external ref: ${ref.system} ${ref.key}`);
  }
  const clean: ExternalRef = {
    system: ref.system,
    key: ref.key,
    ...(ref.url ? { url: ref.url } : {}),
  };
  return putNode(graph, { ...node, externalRefs: [...node.externalRefs, clean] });
}

/** Removes the external ref identified by (system, key). */
export function removeExternalRef(
  graph: ProjectGraph,
  id: string,
  system: string,
  key: string,
): ProjectGraph {
  const node = requireNode(graph, id);
  const externalRefs = node.externalRefs.filter(
    (r) => !(r.system === system && r.key === key),
  );
  if (externalRefs.length === node.externalRefs.length) {
    throw new GraphError(`No external ref ${system} ${key} on node ${id}`);
  }
  return putNode(graph, { ...node, externalRefs });
}

/** Throws unless every range is well-formed (non-empty ISO bounds, start ≤ end). */
function validateRanges(ranges: unknown, label: string): asserts ranges is DateRange[] {
  if (!Array.isArray(ranges)) throw new GraphError(`${label} must be an array`);
  for (const r of ranges as DateRange[]) {
    if (typeof r?.start !== 'string' || r.start === '' || typeof r?.end !== 'string' || r.end === '') {
      throw new GraphError(`${label} range needs a start and end date`);
    }
    if (r.start > r.end) throw new GraphError(`${label} range's start must not be after its end`);
  }
}

/** Patches project settings, validating capacity/conversion invariants. */
export function updateSettings(
  graph: ProjectGraph,
  patch: Partial<ProjectSettings>,
): ProjectGraph {
  const settings: ProjectSettings = { ...graph.settings, ...patch };
  if (!(settings.speedMultiplier > 0)) {
    throw new GraphError('speedMultiplier must be greater than 0');
  }
  if (!(settings.pointsPerDay > 0)) {
    throw new GraphError('pointsPerDay must be greater than 0');
  }
  if (!(settings.hoursPerWeek > 0)) {
    throw new GraphError('hoursPerWeek must be greater than 0');
  }
  if (!Array.isArray(settings.resources)) {
    throw new GraphError('resources must be an array');
  }
  const seen = new Set<string>();
  for (const r of settings.resources) {
    if (typeof r.id !== 'string' || r.id === '') {
      throw new GraphError('resource needs an id');
    }
    if (seen.has(r.id)) throw new GraphError(`duplicate resource id: ${r.id}`);
    seen.add(r.id);
    if (!(r.fte > 0)) throw new GraphError('resource fte must be greater than 0');
    validateRanges(r.leave, 'resource leave');
  }
  validateRanges(settings.holidays, 'holidays');
  if (!Number.isInteger(settings.specLockDepth) || settings.specLockDepth < 0) {
    throw new GraphError('specLockDepth must be a non-negative integer');
  }
  if (!Number.isInteger(settings.planLockDepth) || settings.planLockDepth < 0) {
    throw new GraphError('planLockDepth must be a non-negative integer');
  }
  return { ...graph, settings };
}

/* -------------------------------- resources ------------------------------- */

/** Adds a team resource (defaults to full time). Rejects a blank name. */
export function addResource(
  graph: ProjectGraph,
  input: { id: string; name: string; fte?: number },
): ProjectGraph {
  const name = input.name.trim();
  const fte = input.fte ?? 1;
  const resource: Resource = { id: input.id, name, fte, leave: [] };
  return updateSettings(graph, {
    resources: [...graph.settings.resources, resource],
  });
}

/** Patches a resource's name, fte and/or leave; validation runs in updateSettings. */
export function updateResource(
  graph: ProjectGraph,
  id: string,
  patch: { name?: string; fte?: number; leave?: DateRange[] },
): ProjectGraph {
  if (!graph.settings.resources.some((r) => r.id === id)) {
    throw new GraphError(`No resource with id ${id}`);
  }
  const resources = graph.settings.resources.map((r) =>
    r.id === id
      ? {
          ...r,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.fte !== undefined ? { fte: patch.fte } : {}),
          ...(patch.leave !== undefined ? { leave: patch.leave } : {}),
        }
      : r,
  );
  return updateSettings(graph, { resources });
}

/**
 * Removes a resource and clears it from every node assigned to it, so no
 * `resourceId` dangles. Undoable as one step with the settings change.
 */
export function removeResource(graph: ProjectGraph, id: string): ProjectGraph {
  if (!graph.settings.resources.some((r) => r.id === id)) {
    throw new GraphError(`No resource with id ${id}`);
  }
  let next = updateSettings(graph, {
    resources: graph.settings.resources.filter((r) => r.id !== id),
  });
  for (const node of Object.values(next.nodes)) {
    if (node.resourceId === id) next = putNode(next, { ...node, resourceId: null });
  }
  return next;
}

/**
 * Assigns a node to a resource (or clears with null). Traceability-style —
 * meaningful on group nodes, where it pins the scheduling unit to that
 * resource's track. Rejects an unknown resource id.
 */
export function assignResource(
  graph: ProjectGraph,
  id: string,
  resourceId: string | null,
): ProjectGraph {
  const node = requireNode(graph, id);
  if (resourceId !== null && !graph.settings.resources.some((r) => r.id === resourceId)) {
    throw new GraphError(`No resource with id ${resourceId}`);
  }
  return putNode(graph, { ...node, resourceId });
}
