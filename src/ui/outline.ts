/**
 * Pure helpers behind the outliner view: flatten the 'contains' forest
 * into visible rows and compute the structural targets for keyboard
 * operations (indent, outdent, reorder, insert-after).
 *
 * Root-level nodes have no 'contains' edge to carry an order, so roots
 * are shown in (createdAt, id) order. Consequence: new/outdented roots
 * sort by creation time rather than by where the cursor was. Fine for
 * the common single-root spec; revisit if multi-root reordering matters.
 */

import { childrenOf, parentOf, rootsOf } from '../model/graph.ts';
import type { ProjectGraph } from '../model/types.ts';

export interface OutlineRow {
  id: string;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
}

export function orderedRoots(graph: ProjectGraph): string[] {
  return rootsOf(graph).sort((a, b) => {
    const na = graph.nodes[a]!;
    const nb = graph.nodes[b]!;
    return na.createdAt.localeCompare(nb.createdAt) || a.localeCompare(b);
  });
}

/** Siblings of `id` in display order, including `id` itself. */
export function siblingsOf(graph: ProjectGraph, id: string): string[] {
  const parent = parentOf(graph, id);
  return parent === null ? orderedRoots(graph) : childrenOf(graph, parent);
}

/** Depth-first flattening of the forest, skipping collapsed subtrees. */
export function visibleRows(
  graph: ProjectGraph,
  collapsed: ReadonlySet<string>,
): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const visit = (id: string, depth: number): void => {
    const children = childrenOf(graph, id);
    const isCollapsed = collapsed.has(id) && children.length > 0;
    rows.push({ id, depth, hasChildren: children.length > 0, collapsed: isCollapsed });
    if (!isCollapsed) {
      for (const child of children) visit(child, depth + 1);
    }
  };
  for (const root of orderedRoots(graph)) visit(root, 0);
  return rows;
}

/**
 * Where a new sibling created "after `id`" goes. At root level the
 * index is meaningless (roots are creation-ordered); callers only need
 * parentId there.
 */
export function insertionPointAfter(
  graph: ProjectGraph,
  id: string,
): { parentId: string | null; index: number } {
  const parentId = parentOf(graph, id);
  return { parentId, index: siblingsOf(graph, id).indexOf(id) + 1 };
}

/** Indenting makes `id` the last child of its previous sibling. */
export function indentTarget(graph: ProjectGraph, id: string): string | null {
  const siblings = siblingsOf(graph, id);
  const index = siblings.indexOf(id);
  return index > 0 ? siblings[index - 1]! : null;
}

/** Outdenting makes `id` the sibling immediately after its parent. */
export function outdentTarget(
  graph: ProjectGraph,
  id: string,
): { parentId: string | null; index: number } | null {
  const parent = parentOf(graph, id);
  if (parent === null) return null;
  return insertionPointAfter(graph, parent);
}

/** Swap target for Alt+Up/Down. Null when at the edge or at root level. */
export function reorderTarget(
  graph: ProjectGraph,
  id: string,
  delta: -1 | 1,
): { parentId: string; index: number } | null {
  const parentId = parentOf(graph, id);
  if (parentId === null) return null;
  const siblings = childrenOf(graph, parentId);
  const index = siblings.indexOf(id) + delta;
  if (index < 0 || index >= siblings.length) return null;
  return { parentId, index };
}
