/**
 * Dependency analysis over ProjectGraph, all pure.
 *
 * The dependency relation combines two edge types into "A needs B":
 * `depends_on` (from needs to) and `blocks` (from blocks to, i.e. to
 * needs from). Cycles are allowed by the model — this module finds
 * them (Tarjan SCC) so views can highlight, never forbid.
 */

import type { ProjectGraph } from './types.ts';

/** Direct prerequisites of `id`: the nodes it needs first. */
export function prerequisitesOf(graph: ProjectGraph, id: string): string[] {
  const result: string[] = [];
  for (const edge of Object.values(graph.edges)) {
    if (edge.type === 'depends_on' && edge.from === id) result.push(edge.to);
    else if (edge.type === 'blocks' && edge.to === id) result.push(edge.from);
  }
  return result;
}

/** Direct dependents of `id`: the nodes that need it. */
export function dependentsOf(graph: ProjectGraph, id: string): string[] {
  const result: string[] = [];
  for (const edge of Object.values(graph.edges)) {
    if (edge.type === 'depends_on' && edge.to === id) result.push(edge.from);
    else if (edge.type === 'blocks' && edge.from === id) result.push(edge.to);
  }
  return result;
}

/** Adjacency of the dependency relation: node → nodes it needs. */
export function dependencyAdjacency(graph: ProjectGraph): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  const add = (from: string, to: string): void => {
    const list = adjacency.get(from);
    if (list) list.push(to);
    else adjacency.set(from, [to]);
  };
  for (const edge of Object.values(graph.edges)) {
    if (edge.type === 'depends_on') add(edge.from, edge.to);
    else if (edge.type === 'blocks') add(edge.to, edge.from);
  }
  return adjacency;
}

/**
 * Tarjan strongly-connected components over the dependency relation.
 * Only real cycles are returned (component size > 1; self-edges are
 * impossible by model invariant).
 */
export function dependencyCycles(graph: ProjectGraph): string[][] {
  const adjacency = dependencyAdjacency(graph);
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let counter = 0;
  const components: string[][] = [];

  const strongConnect = (v: string): void => {
    index.set(v, counter);
    lowLink.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of adjacency.get(v) ?? []) {
      if (!graph.nodes[w]) continue;
      if (!index.has(w)) {
        strongConnect(w);
        lowLink.set(v, Math.min(lowLink.get(v)!, lowLink.get(w)!));
      } else if (onStack.has(w)) {
        lowLink.set(v, Math.min(lowLink.get(v)!, index.get(w)!));
      }
    }
    if (lowLink.get(v) === index.get(v)) {
      const component: string[] = [];
      for (;;) {
        const w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
        if (w === v) break;
      }
      if (component.length > 1) components.push(component);
    }
  };

  for (const v of adjacency.keys()) {
    if (graph.nodes[v] && !index.has(v)) strongConnect(v);
  }
  return components;
}

/** Node id → index of its cycle in dependencyCycles(); members only. */
export function cycleIndexOf(graph: ProjectGraph): Map<string, number> {
  const map = new Map<string, number>();
  dependencyCycles(graph).forEach((component, i) => {
    for (const id of component) map.set(id, i);
  });
  return map;
}

/**
 * Node → its unfinished direct prerequisites, for every node that has
 * any. "Unfinished" is any status but 'done' — the node is waiting.
 */
export function waitingMap(graph: ProjectGraph): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [id, prerequisites] of dependencyAdjacency(graph)) {
    if (!graph.nodes[id]) continue;
    const waiting = prerequisites.filter(
      (p) => graph.nodes[p] !== undefined && graph.nodes[p]!.status !== 'done',
    );
    if (waiting.length > 0) result.set(id, waiting);
  }
  return result;
}
