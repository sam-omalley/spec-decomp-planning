/**
 * Pure layout for the graph view: the two 'contains' forests face each
 * other — the spec tree grows left-to-right, the delivery tree is
 * mirrored right-to-left — so 'assigned_to' edges bridge the gap
 * between the leaves in the middle.
 *
 * Classic tidy layout per forest: leaves take consecutive rows, a
 * parent sits at the midpoint of its children. The shorter forest is
 * vertically centered against the taller one.
 *
 * An optional `visible` set restricts the layout to a sub-graph — used
 * by the graph view's hide filter so the survivors re-flow compactly
 * instead of leaving gaps. Children are filtered to visible nodes, and
 * a visible node whose parent is hidden is promoted to a root, keeping
 * both forests well-formed.
 *
 * Sort modes (issue #42): by default (`'locked'`) each side keeps its own
 * native `contains`/root order — sibling order never depends on the other
 * side, so editing one side never reshuffles the other (the same reasoning
 * that kept `depLayout.ts`'s ordering stable, see its header comment).
 * `'lockSpec'`/`'lockPlan'` are opt-in: one side stays locked to its native
 * order and the *other* side's siblings are re-sorted at every level by a
 * barycenter — the average row of every `assigned_to` connection touching
 * that node's subtree — so the free side visually aligns with what it's
 * assigned to. A node (or subtree) with no assignment at all has no
 * preference and sorts after its assigned siblings, keeping its relative
 * order among other unassigned siblings.
 */

import { childrenOf, groupRootsOf, rootsOf } from '../model/graph.ts';
import type { ProjectGraph } from '../model/types.ts';

export const COLUMN_WIDTH = 230;
export const ROW_HEIGHT = 58;
export const BRIDGE_GAP = 280;

/** 'locked' = today's default, each side keeps its own native order.
 *  'lockSpec' = spec order fixed, the plan re-flows to align with it.
 *  'lockPlan' = plan order fixed, the spec re-flows to align with it. */
export type MapSort = 'locked' | 'lockSpec' | 'lockPlan';

export interface PlacedNode {
  id: string;
  side: 'work' | 'group';
  x: number;
  y: number;
}

interface ForestLayout {
  positions: Map<string, { depth: number; row: number }>;
  rowCount: number;
  maxDepth: number;
}

function layoutForest(
  roots: string[],
  children: (id: string) => string[],
): ForestLayout {
  const positions = new Map<string, { depth: number; row: number }>();
  let nextRow = 0;
  let maxDepth = 0;

  const visit = (id: string, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    const kids = children(id);
    let row: number;
    if (kids.length === 0) {
      row = nextRow++;
    } else {
      const childRows = kids.map((child) => visit(child, depth + 1));
      row = (childRows[0]! + childRows[childRows.length - 1]!) / 2;
    }
    positions.set(id, { depth, row });
    return row;
  };

  for (const root of roots) visit(root, 0);
  return { positions, rowCount: nextRow, maxDepth };
}

/**
 * Roots of the visible sub-forest, in the full tree's pre-order: every
 * visible node whose parent is absent from `visible` (or a top root).
 */
function visibleRoots(
  graph: ProjectGraph,
  topRoots: string[],
  visible: ReadonlySet<string>,
): string[] {
  const roots: string[] = [];
  const visit = (id: string, parentVisible: boolean): void => {
    const shown = visible.has(id);
    if (shown && !parentVisible) roots.push(id);
    for (const child of childrenOf(graph, id)) visit(child, shown);
  };
  for (const root of topRoots) visit(root, false);
  return roots;
}

function forestFor(
  graph: ProjectGraph,
  topRoots: string[],
  visible: ReadonlySet<string> | undefined,
): ForestLayout {
  if (!visible) return layoutForest(topRoots, (id) => childrenOf(graph, id));
  const children = (id: string): string[] =>
    childrenOf(graph, id).filter((c) => visible.has(c));
  return layoutForest(visibleRoots(graph, topRoots, visible), children);
}

/** `id -> row` from an already-laid-out (locked) forest. */
function rowsOf(forest: ForestLayout): Map<string, number> {
  const rows = new Map<string, number>();
  for (const [id, pos] of forest.positions) rows.set(id, pos.row);
  return rows;
}

/**
 * For every node on `freeSide`, the average locked-side row of every
 * `assigned_to` connection touching that node's own subtree (null if none).
 * Aggregated bottom-up in one pass so a container's target reflects every
 * assignment anywhere beneath it, not just its own direct members.
 */
function barycenterTargets(
  graph: ProjectGraph,
  freeSide: 'work' | 'group',
  lockedRow: ReadonlyMap<string, number>,
): Map<string, number | null> {
  const direct = new Map<string, number[]>();
  for (const edge of Object.values(graph.edges)) {
    if (edge.type !== 'assigned_to') continue;
    const freeId = freeSide === 'work' ? edge.from : edge.to;
    const lockedId = freeSide === 'work' ? edge.to : edge.from;
    const row = lockedRow.get(lockedId);
    if (row === undefined) continue;
    const rows = direct.get(freeId);
    if (rows) rows.push(row);
    else direct.set(freeId, [row]);
  }

  const targets = new Map<string, number | null>();
  const visit = (id: string): { sum: number; count: number } => {
    let sum = 0;
    let count = 0;
    for (const row of direct.get(id) ?? []) {
      sum += row;
      count++;
    }
    for (const child of childrenOf(graph, id)) {
      const r = visit(child);
      sum += r.sum;
      count += r.count;
    }
    targets.set(id, count > 0 ? sum / count : null);
    return { sum, count };
  };
  const roots = freeSide === 'work' ? rootsOf(graph) : groupRootsOf(graph);
  for (const root of roots) visit(root);
  return targets;
}

/** Stable-sorts ids by barycenter target; a null target (no assignment
 *  anywhere in the subtree) sorts after every targeted sibling, keeping its
 *  relative order among the other unassigned ones. */
function byTarget(ids: string[], targets: ReadonlyMap<string, number | null>): string[] {
  return ids
    .map((id, i) => ({ id, i, key: targets.get(id) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map((x) => x.id);
}

/** Like `forestFor`, but re-sorts every level's siblings (roots included)
 *  by `targets` instead of using the tree's native order. */
function reflowForestFor(
  graph: ProjectGraph,
  topRoots: string[],
  visible: ReadonlySet<string> | undefined,
  targets: ReadonlyMap<string, number | null>,
): ForestLayout {
  const rawRoots = visible ? visibleRoots(graph, topRoots, visible) : topRoots;
  const children = (id: string): string[] => {
    const kids = visible ? childrenOf(graph, id).filter((c) => visible.has(c)) : childrenOf(graph, id);
    return byTarget(kids, targets);
  };
  return layoutForest(byTarget(rawRoots, targets), children);
}

export function layoutGraph(
  graph: ProjectGraph,
  visible?: ReadonlySet<string>,
  sort: MapSort = 'locked',
): PlacedNode[] {
  let work: ForestLayout;
  let groups: ForestLayout;
  if (sort === 'lockSpec') {
    work = forestFor(graph, rootsOf(graph), visible);
    groups = reflowForestFor(
      graph,
      groupRootsOf(graph),
      visible,
      barycenterTargets(graph, 'group', rowsOf(work)),
    );
  } else if (sort === 'lockPlan') {
    groups = forestFor(graph, groupRootsOf(graph), visible);
    work = reflowForestFor(
      graph,
      rootsOf(graph),
      visible,
      barycenterTargets(graph, 'work', rowsOf(groups)),
    );
  } else {
    work = forestFor(graph, rootsOf(graph), visible);
    groups = forestFor(graph, groupRootsOf(graph), visible);
  }

  // Vertical centering of the shorter forest against the taller one.
  const workOffset = Math.max(0, (groups.rowCount - work.rowCount) / 2);
  const groupOffset = Math.max(0, (work.rowCount - groups.rowCount) / 2);

  // The group forest starts to the right of the deepest work column,
  // with its root in the rightmost column (mirrored depth).
  const groupX0 = work.maxDepth * COLUMN_WIDTH + BRIDGE_GAP;

  const placed: PlacedNode[] = [];
  for (const [id, { depth, row }] of work.positions) {
    placed.push({
      id,
      side: 'work',
      x: depth * COLUMN_WIDTH,
      y: (row + workOffset) * ROW_HEIGHT,
    });
  }
  for (const [id, { depth, row }] of groups.positions) {
    placed.push({
      id,
      side: 'group',
      x: groupX0 + (groups.maxDepth - depth) * COLUMN_WIDTH,
      y: (row + groupOffset) * ROW_HEIGHT,
    });
  }
  return placed;
}
