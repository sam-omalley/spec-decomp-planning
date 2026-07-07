/**
 * Pure helpers behind the outliner views: flatten a 'contains' forest
 * into visible rows and compute the structural targets for keyboard
 * operations (indent, outdent, reorder, insert-after). Root order is
 * authoritative in the graph, so every operation works the same at
 * root level as anywhere else — and the same helpers drive both the
 * spec outliner (work side) and the delivery outliner (group side),
 * since each node's side determines which root order applies.
 */

import { childrenOf, groupRootsOf, parentOf, rootsOf } from '../model/graph.ts';
import type { ProjectGraph } from '../model/types.ts';

export type OutlineSide = 'work' | 'group';

export interface OutlineRow {
  id: string;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  /**
   * Only set while a filter is active (see the `match` argument to
   * `visibleRows`): true when the row itself matched (highlight), false
   * when it is only shown as ancestor context for a deeper match (dimmed).
   */
  matched?: boolean;
}

function rootsOfSide(graph: ProjectGraph, side: OutlineSide): string[] {
  return side === 'group' ? groupRootsOf(graph) : rootsOf(graph);
}

function sideOf(graph: ProjectGraph, id: string): OutlineSide {
  return graph.nodes[id]?.type === 'group' ? 'group' : 'work';
}

/** Siblings of `id` in display order, including `id` itself. */
export function siblingsOf(graph: ProjectGraph, id: string): string[] {
  const parent = parentOf(graph, id);
  return parent === null ? rootsOfSide(graph, sideOf(graph, id)) : childrenOf(graph, parent);
}

/**
 * Depth-first flattening of one side's forest into visible rows.
 *
 * Without `match`, it skips collapsed subtrees (the normal outliner) and,
 * when `maxDepth` is given, caps the visible tree to the top N levels
 * (roots = depth 0, so "N levels" ⇒ depth < N). A node at the cutoff with
 * hidden descendants renders `collapsed` so it reuses the "+k" child-count
 * affordance.
 *
 * With a `match` predicate (a filter is active), it becomes
 * hierarchy-aware: it keeps every matching node plus the ancestor path to
 * each match, drops the rest, and ignores both per-node collapse *and*
 * `maxDepth` so deep matches always surface (search wins over the depth
 * cap). Each surviving row carries `matched` — true for a real match
 * (highlight), false for an ancestor shown as context (dimmed).
 */
export function visibleRows(
  graph: ProjectGraph,
  collapsed: ReadonlySet<string>,
  side: OutlineSide = 'work',
  match?: (id: string) => boolean,
  maxDepth?: number,
): OutlineRow[] {
  if (match) return filteredRows(graph, side, match);
  const rows: OutlineRow[] = [];
  const visit = (id: string, depth: number): void => {
    const children = childrenOf(graph, id);
    const hasChildren = children.length > 0;
    // Children live at depth+1; if that would reach the cap, stop here and
    // present the node as collapsed so its hidden descendants show as "+k".
    const cappedHere = maxDepth !== undefined && depth + 1 >= maxDepth;
    const isCollapsed = (collapsed.has(id) || cappedHere) && hasChildren;
    rows.push({ id, depth, hasChildren, collapsed: isCollapsed });
    if (!isCollapsed) {
      for (const child of children) visit(child, depth + 1);
    }
  };
  for (const root of rootsOfSide(graph, side)) visit(root, 0);
  return rows;
}

/** Number of levels in one side's forest (deepest row depth + 1); 0 if empty. */
export function treeDepth(graph: ProjectGraph, side: OutlineSide): number {
  let max = -1;
  const visit = (id: string, depth: number): void => {
    if (depth > max) max = depth;
    for (const child of childrenOf(graph, id)) visit(child, depth + 1);
  };
  for (const root of rootsOfSide(graph, side)) visit(root, 0);
  return max + 1;
}

/** Filtered variant: keep matches + their ancestors, collapse ignored. */
function filteredRows(
  graph: ProjectGraph,
  side: OutlineSide,
  match: (id: string) => boolean,
): OutlineRow[] {
  // A node is kept if it matches or has any kept descendant.
  const keep = new Set<string>();
  const walk = (id: string): boolean => {
    let kept = match(id);
    for (const child of childrenOf(graph, id)) {
      if (walk(child)) kept = true;
    }
    if (kept) keep.add(id);
    return kept;
  };
  for (const root of rootsOfSide(graph, side)) walk(root);

  const rows: OutlineRow[] = [];
  const visit = (id: string, depth: number): void => {
    const children = childrenOf(graph, id).filter((c) => keep.has(c));
    rows.push({
      id,
      depth,
      hasChildren: children.length > 0,
      collapsed: false,
      matched: match(id),
    });
    for (const child of children) visit(child, depth + 1);
  };
  for (const root of rootsOfSide(graph, side)) {
    if (keep.has(root)) visit(root, 0);
  }
  return rows;
}

/** Where a new sibling created "after `id`" goes. */
export function insertionPointAfter(
  graph: ProjectGraph,
  id: string,
): { parentId: string | null; index: number } {
  const parentId = parentOf(graph, id);
  return { parentId, index: siblingsOf(graph, id).indexOf(id) + 1 };
}

/** Where a new sibling created "before `id`" goes. */
export function insertionPointBefore(
  graph: ProjectGraph,
  id: string,
): { parentId: string | null; index: number } {
  const parentId = parentOf(graph, id);
  return { parentId, index: siblingsOf(graph, id).indexOf(id) };
}

/**
 * Where pressing Enter on `id` inserts the new row so it lands on the
 * very next visible line at the cursor, not after the whole subtree.
 * An expanded parent gets a new first child; a leaf or collapsed row
 * gets a sibling immediately after (its hidden children stay put).
 */
export function insertionPointForEnter(
  graph: ProjectGraph,
  id: string,
  collapsed: ReadonlySet<string>,
): { parentId: string | null; index: number } {
  const hasChildren = childrenOf(graph, id).length > 0;
  if (hasChildren && !collapsed.has(id)) return { parentId: id, index: 0 };
  return insertionPointAfter(graph, id);
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

/** Swap target for Alt+Up/Down. Null when already at the edge. */
export function reorderTarget(
  graph: ProjectGraph,
  id: string,
  delta: -1 | 1,
): { parentId: string | null; index: number } | null {
  const siblings = siblingsOf(graph, id);
  const index = siblings.indexOf(id) + delta;
  if (index < 0 || index >= siblings.length) return null;
  return { parentId: parentOf(graph, id), index };
}

/* ------------------------------------------------------------------ */
/* Bulk paste                                                          */
/* ------------------------------------------------------------------ */

export interface ParsedOutlineLine {
  title: string;
  /** Relative depth: the shallowest lines are 0, each level adds 1. */
  depth: number;
}

/** Strip a leading list marker (`- `, `* `, `+ `, `1. `) after the indent. */
function stripMarker(text: string): string {
  return text.replace(/^(?:[-*+]|\d+[.)])\s+/, '');
}

/**
 * Parse pasted multi-line text into titled rows with relative depths,
 * inferring nesting from each line's leading indentation. Robust to tabs
 * vs. spaces and to irregular indent widths: distinct indentation widths
 * are mapped to consecutive depths with a stack, so a depth never jumps
 * by more than 1 and the shallowest lines sit at depth 0. Blank lines are
 * dropped; a leading Markdown-style bullet marker is removed.
 */
export function parseOutlineText(text: string): ParsedOutlineLine[] {
  const result: ParsedOutlineLine[] = [];
  // Stack of indentation widths for the current ancestor chain; its
  // length (minus one) is the depth of the next line at that indent.
  const indents: number[] = [];
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    if (rawLine.trim() === '') continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const title = stripMarker(rawLine.trim());
    // Pop deeper-or-equal indents; what remains are strict ancestors.
    while (indents.length > 0 && indents[indents.length - 1]! >= indent) {
      indents.pop();
    }
    const depth = indents.length;
    indents.push(indent);
    result.push({ title, depth });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Multi-select structural contract                                    */
/* ------------------------------------------------------------------ */

/**
 * When `ids` all share one parent and are consecutive in that parent's
 * child order, return that parent plus the ids in document order; else
 * null. Group indent/outdent/reorder operate only on such a clean
 * contiguous sibling range, keeping their semantics predictable.
 */
export function contiguousSiblingRange(
  graph: ProjectGraph,
  ids: Iterable<string>,
): { parentId: string | null; ids: string[] } | null {
  const set = new Set(ids);
  if (set.size === 0) return null;
  const first = set.values().next().value as string;
  if (!graph.nodes[first]) return null;
  const parentId = parentOf(graph, first);
  const siblings = siblingsOf(graph, first);
  const positions: number[] = [];
  for (const id of set) {
    if (parentOf(graph, id) !== parentId) return null;
    const at = siblings.indexOf(id);
    if (at === -1) return null;
    positions.push(at);
  }
  positions.sort((a, b) => a - b);
  for (let i = 1; i < positions.length; i++) {
    if (positions[i]! !== positions[i - 1]! + 1) return null;
  }
  return { parentId, ids: positions.map((p) => siblings[p]!) };
}
