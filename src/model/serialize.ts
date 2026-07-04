/**
 * Project file format: a versioned JSON envelope around the graph.
 * Used for both the .json save/load feature and IndexedDB autosave.
 *
 * v1 → v2: added `rootOrder` (display order of spec-tree roots). On
 * load, rootOrder is reconciled against the actual root set: stale ids
 * are dropped and missing roots are appended by createdAt — which is
 * exactly the order v1 files displayed, so migration is implicit.
 */

import type { Edge, ProjectGraph, WorkNode } from './types.ts';
import { GraphError } from './graph.ts';

export const FILE_VERSION = 2;

export interface ProjectFile {
  version: typeof FILE_VERSION;
  savedAt: string;
  graph: ProjectGraph;
}

const SUPPORTED_VERSIONS: readonly number[] = [1, FILE_VERSION];

export function serializeProject(graph: ProjectGraph): string {
  const file: ProjectFile = {
    version: FILE_VERSION,
    savedAt: new Date().toISOString(),
    graph,
  };
  return JSON.stringify(file, null, 2);
}

function reconcileRootOrder(
  nodes: Record<string, WorkNode>,
  edges: Record<string, Edge>,
  provided: unknown,
): string[] {
  const hasParent = new Set<string>();
  for (const edge of Object.values(edges)) {
    if (edge.type === 'contains') hasParent.add(edge.to);
  }
  const roots = Object.values(nodes)
    .filter((n) => n.type !== 'epic' && !hasParent.has(n.id))
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
  const missing = roots
    .filter((id) => !listed.has(id))
    .sort((a, b) => {
      const na = nodes[a]!;
      const nb = nodes[b]!;
      return na.createdAt.localeCompare(nb.createdAt) || a.localeCompare(b);
    });
  return [...order, ...missing];
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
  const file = parsed as Partial<ProjectFile>;
  if (typeof file.version !== 'number' || !SUPPORTED_VERSIONS.includes(file.version)) {
    throw new GraphError(`Unsupported project file version: ${String(file.version)}`);
  }
  const graph = file.graph;
  if (
    typeof graph !== 'object' ||
    graph === null ||
    typeof graph.nodes !== 'object' ||
    typeof graph.edges !== 'object' ||
    typeof graph.plans !== 'object'
  ) {
    throw new GraphError('Not a valid project file: missing graph data');
  }
  for (const edge of Object.values(graph.edges)) {
    if (!graph.nodes[edge.from] || !graph.nodes[edge.to]) {
      throw new GraphError(`Project file is corrupt: edge ${edge.id} references a missing node`);
    }
  }
  return {
    nodes: graph.nodes,
    edges: graph.edges,
    plans: graph.plans,
    rootOrder: reconcileRootOrder(graph.nodes, graph.edges, graph.rootOrder),
  };
}
