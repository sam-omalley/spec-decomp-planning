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
 */

import { childrenOf, groupRootsOf, rootsOf } from '../model/graph.ts';
import type { ProjectGraph } from '../model/types.ts';

export const COLUMN_WIDTH = 230;
export const ROW_HEIGHT = 58;
export const BRIDGE_GAP = 280;

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

export function layoutGraph(
  graph: ProjectGraph,
  visible?: ReadonlySet<string>,
): PlacedNode[] {
  const work = forestFor(graph, rootsOf(graph), visible);
  const groups = forestFor(graph, groupRootsOf(graph), visible);

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
