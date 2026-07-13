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
 * Within a layer, nodes keep the plan order (group pre-order). That order
 * is deterministic and stable as dependencies are added — adding an edge
 * can move a node to another column but never reshuffles the vertical
 * order (issue #18). Row coordinates then relax each node toward its
 * neighbours' rows to straighten chains, preserving the order. (An earlier
 * Sugiyama barycenter pass reordered layers to minimise crossings, but the
 * reshuffle-on-every-edit was worse than the crossings it removed.)
 *
 * Implicit sequential chain (display inference only): for sibling leaf
 * groups, a sequential chain in sibling order (A→B→C) is inferred and
 * marked `inferred`. Suppression is per-pair, not all-or-nothing — a
 * consecutive pair loses its ghost edge when the explicit deps already
 * order it (either direction, transitively) or make the two siblings a
 * parallel fan (they share a transitive prerequisite or dependent), so
 * inferred chains coexist with explicit cross-links without serialising
 * genuine fan-out. It never touches the graph and never reaches the
 * scheduler — it only influences this projection.
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

/** Isotonic regression (pool-adjacent-violators): the minimal-displacement
 *  positions closest to `desired` (same order) with each at least `gap`
 *  below the next. Substituting z[i] = pos[i] − i·gap turns the min-gap
 *  constraint into "z non-decreasing", which PAVA solves optimally. */
function packWithGap(desired: number[], gap: number): number[] {
  const n = desired.length;
  if (n === 0) return [];
  // Blocks of equal value, kept non-decreasing by merging on violation.
  const value: number[] = [];
  const count: number[] = [];
  const total: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = desired[i]! - i * gap;
    let cnt = 1;
    while (value.length > 0 && value[value.length - 1]! > sum / cnt) {
      sum += total.pop()!;
      cnt += count.pop()!;
      value.pop();
    }
    value.push(sum / cnt);
    count.push(cnt);
    total.push(sum);
  }
  const out: number[] = [];
  for (let b = 0; b < value.length; b++) {
    for (let k = 0; k < count[b]!; k++) out.push(value[b]! + out.length * gap);
  }
  return out;
}

/** Vertical coordinate assignment. Centring each column on its own row
 *  count (the old approach) ignored where a node's neighbours sat, so a
 *  single-neighbour chain drifted apart and its edges bent. Instead, relax
 *  each node toward the mean row of its neighbours in adjacent layers over a
 *  few down/up sweeps, packing each layer to keep its order and a minimum
 *  row gap (`packWithGap`). Straight chains converge to a straight line;
 *  a fan splits only as much as the gap forces. */
function assignRowCoordinates(
  byLayer: Map<number, string[]>,
  needs: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, number> {
  const neededBy = new Map<string, Set<string>>();
  for (const [node, prereqs] of needs) {
    for (const p of prereqs) {
      let set = neededBy.get(p);
      if (!set) neededBy.set(p, (set = new Set()));
      set.add(node);
    }
  }

  const layers = [...byLayer.keys()].sort((a, b) => a - b);
  const y = new Map<string, number>();
  for (const l of layers) byLayer.get(l)!.forEach((id, i) => y.set(id, i * DEP_ROW_HEIGHT));

  const relax = (l: number, neighboursOf: ReadonlyMap<string, ReadonlySet<string>>): void => {
    const bucket = byLayer.get(l)!;
    const desired = bucket.map((id, i) => {
      const nbrs = [...(neighboursOf.get(id) ?? [])].filter((n) => y.has(n));
      if (nbrs.length === 0) return y.get(id) ?? i * DEP_ROW_HEIGHT;
      let sum = 0;
      for (const n of nbrs) sum += y.get(n)!;
      return sum / nbrs.length;
    });
    const placed = packWithGap(desired, DEP_ROW_HEIGHT);
    bucket.forEach((id, i) => y.set(id, placed[i]!));
  };

  const ITERATIONS = 8;
  for (let s = 0; s < ITERATIONS; s++) {
    for (let i = 1; i < layers.length; i++) relax(layers[i]!, needs); // align to prereqs
    for (let i = layers.length - 2; i >= 0; i--) relax(layers[i]!, neededBy); // to dependents
  }
  return y;
}

/** Transitive closure of a dependency relation (cycle-safe): reach.get(x)
 *  is every node x depends on, directly or indirectly. */
function transitiveNeeds(
  needs: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, Set<string>> {
  const reach = new Map<string, Set<string>>();
  for (const start of needs.keys()) {
    const seen = new Set<string>();
    const stack = [...(needs.get(start) ?? [])];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const m of needs.get(n) ?? []) if (!seen.has(m)) stack.push(m);
    }
    reach.set(start, seen);
  }
  return reach;
}

/** Ghost sequential chains across sibling leaf groups. Suppression is
 *  per-pair and considers the *transitive* explicit relation: a consecutive
 *  pair is skipped when the explicit dependencies already order those two
 *  siblings in either direction (directly or indirectly), or make them a
 *  parallel fan — sharing a transitive prerequisite or dependent, e.g. both
 *  depending on a common A. So the inference only fills in sequencing the
 *  explicit graph leaves genuinely undecided — it never contradicts an
 *  existing ordering (a ghost against the flow, closing a cycle) nor
 *  serialises deliberate fan-out (issue #17). */
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

  const reach = transitiveNeeds(realNeeds);

  // Transitive dependents (the mirror closure), so a shared *downstream*
  // node counts as a parallel fan just like a shared prerequisite.
  const neededBy = new Map<string, Set<string>>();
  for (const [node, prereqs] of realNeeds) {
    for (const p of prereqs) {
      let set = neededBy.get(p);
      if (!set) neededBy.set(p, (set = new Set()));
      set.add(node);
    }
  }
  const reachDependent = transitiveNeeds(neededBy);

  const ordered = (a: string, b: string): boolean =>
    (reach.get(a)?.has(b) ?? false) || (reach.get(b)?.has(a) ?? false);

  const intersects = (
    a: ReadonlySet<string> | undefined,
    b: ReadonlySet<string> | undefined,
  ): boolean => {
    if (!a || !b || a.size === 0 || b.size === 0) return false;
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const x of small) if (large.has(x)) return true;
    return false;
  };

  // Two siblings are a parallel fan — not a sequence — when they share a
  // transitive prerequisite or a transitive dependent (e.g. B, C, D, E all
  // depending on a common A). Chaining them would serialise work the
  // explicit deps deliberately ran in parallel (issue #17).
  const parallel = (a: string, b: string): boolean =>
    intersects(reach.get(a), reach.get(b)) ||
    intersects(reachDependent.get(a), reachDependent.get(b));

  const result: { dependent: string; prerequisite: string }[] = [];
  for (const siblings of siblingLists) {
    const leaves = siblings.filter((s) => leafSet.has(s));
    if (leaves.length < 2) continue;
    for (let i = 1; i < leaves.length; i++) {
      const prev = leaves[i - 1]!;
      const next = leaves[i]!;
      // Skip when the explicit deps already sequence the pair (either
      // direction, transitively) or make them a parallel fan.
      if (ordered(prev, next) || parallel(prev, next)) continue;
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
  // Within a column, keep the plan (group pre-order) order — it is stable
  // as dependencies are added (issue #18), unlike a barycenter reshuffle.
  // Row coordinates then align each node near its neighbours so straight
  // chains stay straight, without changing the order.
  const rowY = assignRowCoordinates(byLayer, combined);

  const nodes: DepGraphNode[] = leaves.map((id) => ({
    id,
    x: layer.get(id)! * DEP_COLUMN_WIDTH,
    y: rowY.get(id)!,
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
