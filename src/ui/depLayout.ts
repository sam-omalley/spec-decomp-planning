/**
 * Pure layout for the Graph tab's Dependency view: the plan's leaf groups
 * (the "stories" — groups with no child group) laid out by the dependency
 * relation. A sibling of `graphLayout.ts`, unit-tested.
 *
 * Nodes are leaf groups; edges are the dependency relation from
 * `analysis.ts` (`depends_on` + inverse `blocks`), restricted to leaves —
 * a dependency on a container fans out to the leaf groups in its subtree,
 * mirroring how `schedule.ts` expands container endpoints to units.
 *
 * Layout is a layered left→right DAG: prerequisites left, dependents
 * right, each node's column its longest prerequisite chain. Cycles are
 * collapsed per Tarjan SCC (they share a column) and reported so the view
 * can draw them red + animated.
 *
 * Within a layer, nodes are ordered by a Sugiyama-style barycenter pass
 * (a few down/up sweeps sorting each layer by the mean position of its
 * neighbours in the adjacent layer) to reduce edge crossings — fan-out /
 * fan-in parallelisation would otherwise read as a dense, crossed grid.
 * The pass is deterministic and stable (ties break by the initial
 * pre-order), and touches `y` only — columns (`x`) and the edge set are
 * unchanged.
 *
 * Implicit sequential chain (display inference only): for sibling leaf
 * groups, a sequential chain in sibling order (A→B→C) is inferred and
 * marked `inferred`. Suppression is per-pair, not all-or-nothing — a
 * consecutive pair loses its ghost edge only if that exact pair is already
 * directly connected by an explicit dependency, so inferred chains coexist
 * with explicit cross-links. It never touches the graph and never reaches
 * the scheduler — it only influences this projection.
 */

import { childrenOf, groupRootsOf, subtreeIds } from '../model/graph.ts';
import { dependencyAdjacency } from '../model/analysis.ts';
import type { ProjectGraph } from '../model/types.ts';
import { rootGroupColor } from './colors.ts';

export const DEP_COLUMN_WIDTH = 240;
export const DEP_ROW_HEIGHT = 66;

export interface DepGraphNode {
  id: string;
  x: number;
  y: number;
  /** Root-group family color. */
  color: string;
  /** Index of its real-dependency cycle, or null if acyclic. */
  cycle: number | null;
}

export interface DepGraphEdge {
  /** The node that needs the other first. */
  dependent: string;
  /** The node needed first. */
  prerequisite: string;
  /** True for a ghosted sequential-chain edge (display inference only). */
  inferred: boolean;
  /** True when both endpoints share a real-dependency cycle. */
  inCycle: boolean;
}

export interface DepGraphLayout {
  nodes: DepGraphNode[];
  edges: DepGraphEdge[];
}

export interface DepLayoutOptions {
  /** Ghost a sequential chain across dep-free sibling leaves. */
  inferChains?: boolean;
}

/** Leaf groups (no child group), in group pre-order. */
function leafGroups(graph: ProjectGraph): string[] {
  const leaves: string[] = [];
  const visit = (id: string): void => {
    if (graph.nodes[id]?.type !== 'group') return;
    const kids = childrenOf(graph, id);
    if (kids.length === 0) {
      leaves.push(id);
      return;
    }
    for (const kid of kids) visit(kid);
  };
  for (const root of groupRootsOf(graph)) visit(root);
  return leaves;
}

/** The leaf groups a dependency endpoint resolves to: itself if a leaf,
 *  else every leaf group in its subtree (a container fans out). */
function leavesFor(
  graph: ProjectGraph,
  id: string,
  leafSet: ReadonlySet<string>,
): string[] {
  if (leafSet.has(id)) return [id];
  return [...subtreeIds(graph, id)].filter((n) => leafSet.has(n));
}

/** Tarjan SCCs over an adjacency map; components in reverse-topological
 *  order. Singletons included. */
function stronglyConnected(
  nodes: string[],
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let counter = 0;
  const components: string[][] = [];

  const connect = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of adjacency.get(v) ?? []) {
      if (!index.has(w)) {
        connect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const component: string[] = [];
      for (;;) {
        const w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
        if (w === v) break;
      }
      components.push(component);
    }
  };

  for (const v of nodes) if (!index.has(v)) connect(v);
  return components;
}

/** Longest-path layering over the dependency relation, cycle-safe: SCCs
 *  are condensed to a DAG, then each component's layer is 1 + its deepest
 *  prerequisite component. Prerequisites land in lower (left) columns. */
function longestPathLayers(
  nodes: string[],
  needs: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, number> {
  const components = stronglyConnected(nodes, needs);
  const componentOf = new Map<string, number>();
  components.forEach((component, i) => {
    for (const n of component) componentOf.set(n, i);
  });

  const condensed = new Map<number, Set<number>>();
  for (let i = 0; i < components.length; i++) condensed.set(i, new Set());
  for (const [node, prereqs] of needs) {
    const ci = componentOf.get(node)!;
    for (const p of prereqs) {
      const cj = componentOf.get(p);
      if (cj !== undefined && cj !== ci) condensed.get(ci)!.add(cj);
    }
  }

  const memo = new Map<number, number>();
  const depth = (c: number): number => {
    const cached = memo.get(c);
    if (cached !== undefined) return cached;
    let best = 0;
    for (const d of condensed.get(c)!) best = Math.max(best, depth(d) + 1);
    memo.set(c, best);
    return best;
  };

  const layer = new Map<string, number>();
  for (const n of nodes) layer.set(n, depth(componentOf.get(n)!));
  return layer;
}

/** Barycenter crossing-reduction: reorder the nodes inside each layer so
 *  they sit near their neighbours in the adjacent layers, cutting edge
 *  crossings for fan-out / fan-in. Deterministic — a fixed number of
 *  down (order by prerequisites) / up (order by dependents) sweeps, ties
 *  broken by the incoming order so it is stable. Mutates the per-layer
 *  buckets in place. `needs` is the (combined) dependency relation. */
function orderWithinLayers(
  byLayer: Map<number, string[]>,
  needs: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  const neededBy = new Map<string, Set<string>>();
  for (const [node, prereqs] of needs) {
    for (const p of prereqs) {
      let set = neededBy.get(p);
      if (!set) neededBy.set(p, (set = new Set()));
      set.add(node);
    }
  }

  const layers = [...byLayer.keys()].sort((a, b) => a - b);
  const order = new Map<string, number>();
  const reindex = (bucket: string[]): void => bucket.forEach((id, i) => order.set(id, i));
  for (const l of layers) reindex(byLayer.get(l)!);

  const sweep = (
    l: number,
    neighboursOf: ReadonlyMap<string, ReadonlySet<string>>,
  ): void => {
    const bucket = byLayer.get(l)!;
    const bary = new Map<string, number>();
    bucket.forEach((id, i) => {
      const nbrs = [...(neighboursOf.get(id) ?? [])].filter((n) => order.has(n));
      if (nbrs.length === 0) {
        bary.set(id, i); // no anchor on this side — hold current position
        return;
      }
      let sum = 0;
      for (const n of nbrs) sum += order.get(n)!;
      bary.set(id, sum / nbrs.length);
    });
    const sorted = bucket
      .map((id, i) => ({ id, i }))
      .sort((a, b) => bary.get(a.id)! - bary.get(b.id)! || a.i - b.i)
      .map((x) => x.id);
    byLayer.set(l, sorted);
    reindex(sorted);
  };

  const SWEEPS = 4;
  for (let s = 0; s < SWEEPS; s++) {
    for (let i = 1; i < layers.length; i++) sweep(layers[i]!, needs);
    for (let i = layers.length - 2; i >= 0; i--) sweep(layers[i]!, neededBy);
  }
}

/** Ghost sequential chains across sibling leaf groups. Suppression is
 *  per-pair: a consecutive pair is skipped only when that exact pair is
 *  already directly connected by an explicit dependency (either
 *  direction), so inferred chains coexist with explicit cross-links. */
function inferredChains(
  graph: ProjectGraph,
  leafSet: ReadonlySet<string>,
  realNeeds: ReadonlyMap<string, ReadonlySet<string>>,
): { dependent: string; prerequisite: string }[] {
  const siblingLists: string[][] = [groupRootsOf(graph)];
  for (const node of Object.values(graph.nodes)) {
    if (node.type !== 'group') continue;
    const kids = childrenOf(graph, node.id);
    if (kids.length > 0) siblingLists.push(kids);
  }

  const linked = (a: string, b: string): boolean =>
    (realNeeds.get(a)?.has(b) ?? false) || (realNeeds.get(b)?.has(a) ?? false);

  const result: { dependent: string; prerequisite: string }[] = [];
  for (const siblings of siblingLists) {
    const leaves = siblings.filter((s) => leafSet.has(s));
    if (leaves.length < 2) continue;
    for (let i = 1; i < leaves.length; i++) {
      const prev = leaves[i - 1]!;
      const next = leaves[i]!;
      if (linked(prev, next)) continue; // pair already explicitly sequenced
      result.push({ dependent: next, prerequisite: prev });
    }
  }
  return result;
}

export function layoutDependencies(
  graph: ProjectGraph,
  options: DepLayoutOptions = {},
): DepGraphLayout {
  const leaves = leafGroups(graph);
  if (leaves.length === 0) return { nodes: [], edges: [] };
  const leafSet = new Set(leaves);

  // Real dependency relation among leaves, fanning containers out.
  const realNeeds = new Map<string, Set<string>>();
  for (const l of leaves) realNeeds.set(l, new Set());
  for (const [node, prereqs] of dependencyAdjacency(graph)) {
    if (graph.nodes[node]?.type !== 'group') continue;
    const dependents = leavesFor(graph, node, leafSet);
    for (const prereq of prereqs) {
      if (graph.nodes[prereq]?.type !== 'group') continue;
      const prereqLeaves = leavesFor(graph, prereq, leafSet);
      for (const dl of dependents) {
        for (const pl of prereqLeaves) {
          if (dl !== pl) realNeeds.get(dl)!.add(pl);
        }
      }
    }
  }

  const inferred = options.inferChains
    ? inferredChains(graph, leafSet, realNeeds)
    : [];

  // Real SCCs mark cycles (inferred chains are acyclic by construction and
  // never count as dependency problems).
  const cycleOf = new Map<string, number>();
  let cycleIndex = 0;
  for (const component of stronglyConnected(leaves, realNeeds)) {
    if (component.length > 1) {
      for (const n of component) cycleOf.set(n, cycleIndex);
      cycleIndex++;
    }
  }

  // Layering uses the real relation plus any shown inference so dep-free
  // siblings cascade left→right instead of stacking in one column.
  const combined = new Map<string, Set<string>>();
  for (const l of leaves) combined.set(l, new Set(realNeeds.get(l)));
  for (const e of inferred) combined.get(e.dependent)!.add(e.prerequisite);
  const layer = longestPathLayers(leaves, combined);

  const byLayer = new Map<number, string[]>();
  for (const id of leaves) {
    const l = layer.get(id)!;
    const bucket = byLayer.get(l);
    if (bucket) bucket.push(id);
    else byLayer.set(l, [id]);
  }
  // Reduce crossings within each column before placing rows.
  orderWithinLayers(byLayer, combined);
  let maxRows = 0;
  for (const bucket of byLayer.values()) maxRows = Math.max(maxRows, bucket.length);

  const position = new Map<string, { x: number; y: number }>();
  for (const [l, bucket] of byLayer) {
    const offset = (maxRows - bucket.length) / 2;
    bucket.forEach((id, i) => {
      position.set(id, {
        x: l * DEP_COLUMN_WIDTH,
        y: (i + offset) * DEP_ROW_HEIGHT,
      });
    });
  }

  const nodes: DepGraphNode[] = leaves.map((id) => ({
    id,
    x: position.get(id)!.x,
    y: position.get(id)!.y,
    color: rootGroupColor(graph, id),
    cycle: cycleOf.has(id) ? cycleOf.get(id)! : null,
  }));

  const edges: DepGraphEdge[] = [];
  for (const [dependent, prereqs] of realNeeds) {
    for (const prerequisite of prereqs) {
      const inCycle =
        cycleOf.has(dependent) && cycleOf.get(dependent) === cycleOf.get(prerequisite);
      edges.push({ dependent, prerequisite, inferred: false, inCycle });
    }
  }
  for (const e of inferred) {
    edges.push({ ...e, inferred: true, inCycle: false });
  }

  return { nodes, edges };
}
