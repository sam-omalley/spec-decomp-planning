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
 *
 * v3 → v4: the project-management extension. Work nodes gain
 * `durationEstimate`, `actualStart`, `actualFinish`, `externalRefs`; the
 * graph gains `settings`. Migration is pure backfill of defaults, so no
 * data is lost — earlier versions migrate straight through to v4.
 *
 * v4 → v5: `settings` gains the editing-lock depths (`specLockDepth` /
 * `planLockDepth`), backfilled to 0 (unlocked). Pure backfill, no data loss.
 *
 * v5 → v6: resourcing. Settings drop the anonymous `parallelTracks` count
 * and `hoursPerDay`; they gain a `resources` team and `hoursPerWeek`.
 * Migration converts `hoursPerDay × 5 → hoursPerWeek` (default 38) and, to
 * preserve capacity, turns `parallelTracks > 1` into that many generic
 * full-time resources (a single track stays an empty team). Nodes gain
 * `resourceId` (backfilled null). No data loss.
 */

import type {
  Edge,
  EdgeType,
  ProjectGraph,
  ProjectSettings,
  Resource,
  WorkNode,
} from './types.ts';
import { GraphError, createId, defaultSettings } from './graph.ts';

export const FILE_VERSION = 6;

export interface ProjectFile {
  version: typeof FILE_VERSION;
  savedAt: string;
  graph: ProjectGraph;
}

const SUPPORTED_VERSIONS: readonly number[] = [1, 2, 3, 4, 5, FILE_VERSION];

/** Shape of the graph payload in v1/v2 files. */
interface LegacyGraph {
  nodes: Record<string, WorkNode & { planId?: string }>;
  edges: Record<string, Edge & { type: EdgeType | 'belongs_to_epic' }>;
  plans?: Record<string, { id: string; name: string; createdAt: string }>;
  rootOrder?: unknown;
  groupRootOrder?: unknown;
  settings?: unknown;
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

/** Backfills the v4/v6 work-node fields on any node that predates them. */
function backfillNodeDefaults(nodes: Record<string, WorkNode>): void {
  for (const node of Object.values(nodes)) {
    const n = node as Partial<WorkNode>;
    if (!Array.isArray(n.externalRefs)) n.externalRefs = [];
    if (n.durationEstimate === undefined) n.durationEstimate = null;
    if (n.actualStart === undefined) n.actualStart = null;
    if (n.actualFinish === undefined) n.actualFinish = null;
    if (n.resourceId === undefined) n.resourceId = null;
  }
}

/** Sanitises a persisted resources array; drops entries that aren't valid. */
function normalizeResources(provided: unknown): Resource[] | null {
  if (!Array.isArray(provided)) return null;
  const out: Resource[] = [];
  const seen = new Set<string>();
  for (const item of provided) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || r.id === '' || seen.has(r.id)) continue;
    const fte = typeof r.fte === 'number' && r.fte > 0 ? r.fte : 1;
    out.push({ id: r.id, name: typeof r.name === 'string' ? r.name : '', fte });
    seen.add(r.id);
  }
  return out;
}

/** Merges a persisted settings blob over defaults, field by field. */
function normalizeSettings(provided: unknown): ProjectSettings {
  const base = defaultSettings();
  if (typeof provided !== 'object' || provided === null) return base;
  const p = provided as Record<string, unknown>;
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  // Lock depths are non-negative integers; anything else falls back.
  const lockDepth = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;

  // hoursPerWeek: use it if present, else migrate the old hoursPerDay × 5.
  const hoursPerWeek =
    typeof p.hoursPerWeek === 'number' && p.hoursPerWeek > 0
      ? p.hoursPerWeek
      : typeof p.hoursPerDay === 'number' && p.hoursPerDay > 0
        ? p.hoursPerDay * 5
        : base.hoursPerWeek;

  // resources: use a valid team if present; else migrate a legacy
  // parallelTracks > 1 into that many generic full-time resources so
  // capacity is preserved (a single track becomes an empty team).
  let resources = normalizeResources(p.resources);
  if (resources === null) {
    const tracks = typeof p.parallelTracks === 'number' ? Math.floor(p.parallelTracks) : 1;
    resources =
      tracks > 1
        ? Array.from({ length: tracks }, (_, i) => ({
            id: createId(),
            name: `Resource ${i + 1}`,
            fte: 1,
          }))
        : [];
  }

  return {
    startDate: typeof p.startDate === 'string' ? p.startDate : base.startDate,
    targetDate: typeof p.targetDate === 'string' ? p.targetDate : null,
    pointsPerDay: num(p.pointsPerDay, base.pointsPerDay),
    hoursPerWeek,
    resources,
    speedMultiplier: num(p.speedMultiplier, base.speedMultiplier),
    specLockDepth: lockDepth(p.specLockDepth, base.specLockDepth),
    planLockDepth: lockDepth(p.planLockDepth, base.planLockDepth),
  };
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
      durationEstimate: null,
      actualStart: null,
      actualFinish: null,
      resourceId: null,
      externalRefs: [],
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
  backfillNodeDefaults(graph.nodes);
  // Dependencies are group-only now (the plan sequences, the spec is
  // structural). Drop any legacy dep edge touching a work node.
  for (const [edgeId, edge] of Object.entries(graph.edges)) {
    if (edge.type !== 'depends_on' && edge.type !== 'blocks') continue;
    const from = graph.nodes[edge.from];
    const to = graph.nodes[edge.to];
    if (from?.type !== 'group' || to?.type !== 'group') delete graph.edges[edgeId];
  }

  for (const edge of Object.values(graph.edges)) {
    if (!graph.nodes[edge.from] || !graph.nodes[edge.to]) {
      throw new GraphError(`Project file is corrupt: edge ${edge.id} references a missing node`);
    }
  }
  return {
    nodes: graph.nodes,
    edges: graph.edges as Record<string, Edge>,
    settings: normalizeSettings(graph.settings),
    rootOrder: reconcileRootOrder(graph.nodes, graph.edges, graph.rootOrder, 'work'),
    groupRootOrder: reconcileRootOrder(
      graph.nodes,
      graph.edges,
      graph.groupRootOrder,
      'group',
    ),
  };
}
