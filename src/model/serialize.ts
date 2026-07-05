/**
 * Project file format: a versioned JSON envelope around the graph.
 * Used for both the .json save/load feature and IndexedDB autosave.
 *
 * v1 → v2: added `rootOrder` (display order of spec-tree roots).
 * v2 → v3: plans and epics collapsed into the group forest — each plan
 * becomes a root group, its epics become child groups, and
 * `belongs_to_epic` edges become `assigned_to` (first membership per
 * node wins; membership is single now). Adds `groupRootOrder`.
 *
 * On load, both root orders are reconciled against the actual root
 * sets: stale ids are dropped and missing roots are appended by
 * createdAt — which is exactly the order older files displayed, so
 * migration of ordering is implicit.
 */

import type { Edge, EdgeType, ProjectGraph, WorkNode } from './types.ts';
import { GraphError, createId } from './graph.ts';

export const FILE_VERSION = 3;

export interface ProjectFile {
  version: typeof FILE_VERSION;
  savedAt: string;
  graph: ProjectGraph;
}

const SUPPORTED_VERSIONS: readonly number[] = [1, 2, FILE_VERSION];

/** Shape of the graph payload in v1/v2 files. */
interface LegacyGraph {
  nodes: Record<string, WorkNode & { planId?: string }>;
  edges: Record<string, Edge & { type: EdgeType | 'belongs_to_epic' }>;
  plans?: Record<string, { id: string; name: string; createdAt: string }>;
  rootOrder?: unknown;
  groupRootOrder?: unknown;
}

export function serializeProject(graph: ProjectGraph): string {
  const file: ProjectFile = {
    version: FILE_VERSION,
    savedAt: new Date().toISOString(),
    graph,
  };
  return JSON.stringify(file, null, 2);
}

function byCreatedAt(nodes: Record<string, WorkNode>) {
  return (a: string, b: string): number => {
    const na = nodes[a]!;
    const nb = nodes[b]!;
    return na.createdAt.localeCompare(nb.createdAt) || a.localeCompare(b);
  };
}

function reconcileRootOrder(
  nodes: Record<string, WorkNode>,
  edges: Record<string, Edge>,
  provided: unknown,
  side: 'work' | 'group',
): string[] {
  const hasParent = new Set<string>();
  for (const edge of Object.values(edges)) {
    if (edge.type === 'contains') hasParent.add(edge.to);
  }
  const roots = Object.values(nodes)
    .filter((n) => (n.type === 'group') === (side === 'group') && !hasParent.has(n.id))
    .map((n) => n.id);
  const rootSet = new Set(roots);

  const order: string[] = [];
  if (Array.isArray(provided)) {
    for (const id of provided) {
      if (typeof id === 'string' && rootSet.has(id) && !order.includes(id)) {
        order.push(id);
      }
    }
  }
  const listed = new Set(order);
  const missing = roots.filter((id) => !listed.has(id)).sort(byCreatedAt(nodes));
  return [...order, ...missing];
}

/** Rewrites a v1/v2 payload (plans, epics, belongs_to_epic) in place. */
function migrateLegacy(legacy: LegacyGraph): void {
  const nodes = legacy.nodes;

  // Plans become root groups; their epics become child groups.
  const planIds = Object.keys(legacy.plans ?? {});
  for (const plan of Object.values(legacy.plans ?? {})) {
    if (nodes[plan.id]) {
      throw new GraphError(`Project file is corrupt: plan id collides with node ${plan.id}`);
    }
    nodes[plan.id] = {
      id: plan.id,
      title: plan.name,
      description: '',
      type: 'group',
      status: 'not_started',
      priority: 'medium',
      effort: null,
      tags: [],
      notes: '',
      createdAt: plan.createdAt,
      modifiedAt: plan.createdAt,
    };
  }
  delete legacy.plans;

  const perPlanOrder = new Map<string, number>();
  for (const id of Object.keys(nodes).sort(byCreatedAt(nodes))) {
    const node = nodes[id]!;
    if ((node.type as string) !== 'epic') continue;
    node.type = 'group';
    const planId = node.planId;
    delete node.planId;
    if (planId !== undefined && nodes[planId]) {
      const order = perPlanOrder.get(planId) ?? 0;
      perPlanOrder.set(planId, order + 1);
      const edgeId = createId();
      legacy.edges[edgeId] = {
        id: edgeId,
        type: 'contains',
        from: planId,
        to: id,
        order,
      };
    }
  }

  // Memberships become single assignments; the first per node wins.
  const assigned = new Set<string>();
  for (const [edgeId, edge] of Object.entries(legacy.edges)) {
    if ((edge.type as string) !== 'belongs_to_epic') continue;
    if (assigned.has(edge.from)) {
      delete legacy.edges[edgeId];
    } else {
      assigned.add(edge.from);
      edge.type = 'assigned_to';
    }
  }

  // Old plan tabs implied an order; make migrated plan-groups keep it.
  if (planIds.length > 0) legacy.groupRootOrder = undefined;
}

export function deserializeProject(text: string): ProjectGraph {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GraphError('Not a valid project file: malformed JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new GraphError('Not a valid project file: expected an object');
  }
  const file = parsed as { version?: unknown; graph?: unknown };
  if (typeof file.version !== 'number' || !SUPPORTED_VERSIONS.includes(file.version)) {
    throw new GraphError(`Unsupported project file version: ${String(file.version)}`);
  }
  const graph = file.graph as LegacyGraph | null | undefined;
  if (
    typeof graph !== 'object' ||
    graph === null ||
    typeof graph.nodes !== 'object' ||
    typeof graph.edges !== 'object'
  ) {
    throw new GraphError('Not a valid project file: missing graph data');
  }
  if (file.version < FILE_VERSION) migrateLegacy(graph);

  for (const edge of Object.values(graph.edges)) {
    if (!graph.nodes[edge.from] || !graph.nodes[edge.to]) {
      throw new GraphError(`Project file is corrupt: edge ${edge.id} references a missing node`);
    }
  }
  return {
    nodes: graph.nodes,
    edges: graph.edges as Record<string, Edge>,
    rootOrder: reconcileRootOrder(graph.nodes, graph.edges, graph.rootOrder, 'work'),
    groupRootOrder: reconcileRootOrder(
      graph.nodes,
      graph.edges,
      graph.groupRootOrder,
      'group',
    ),
  };
}
