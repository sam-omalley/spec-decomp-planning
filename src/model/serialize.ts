/**
 * Project file format: a versioned JSON envelope around the graph.
 * Used for both the .json save/load feature and IndexedDB autosave.
 */

import type { ProjectGraph } from './types.ts';
import { GraphError } from './graph.ts';

export const FILE_VERSION = 1;

export interface ProjectFile {
  version: typeof FILE_VERSION;
  savedAt: string;
  graph: ProjectGraph;
}

export function serializeProject(graph: ProjectGraph): string {
  const file: ProjectFile = {
    version: FILE_VERSION,
    savedAt: new Date().toISOString(),
    graph,
  };
  return JSON.stringify(file, null, 2);
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
  if (file.version !== FILE_VERSION) {
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
  return { nodes: graph.nodes, edges: graph.edges, plans: graph.plans };
}
