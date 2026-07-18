/**
 * Pure helpers behind the planning view: which group covers a node
 * (directly or via a 'contains' ancestor), and which group members
 * overlap other groups (allowed, but badged).
 *
 * Overlap respects nesting: a member's descendant assigned *within the
 * member's group subtree* (e.g. feature → Block 1, subtask → an epic
 * inside Block 1) is refinement, not overlap. Only assignments outside
 * that subtree — sibling groups, other blocks, or coarser ancestor
 * groups — get the badge.
 */

import {
  childrenOf,
  groupOf,
  isInSubtreeOf,
  membersOfGroup,
  parentOf,
  rootsOf,
  subtreeIds,
} from '../model/graph.ts';
import type { ProjectGraph } from '../model/types.ts';

export interface Coverage {
  groupId: string;
  /** The node carrying the assignment: `nodeId` itself when direct,
   * otherwise the spec ancestor it is inherited from. */
  via: string;
}

/**
 * Groups covering `nodeId`: its own assignment plus those inherited
 * from spec ancestors, nearest first. One entry per group — when the
 * node and an ancestor are assigned to the same group, the nearest
 * carrier wins.
 */
export function coveringGroups(graph: ProjectGraph, nodeId: string): Coverage[] {
  const result: Coverage[] = [];
  const seen = new Set<string>();
  let current: string | null = nodeId;
  while (current !== null) {
    const groupId = groupOf(graph, current);
    if (groupId !== null && !seen.has(groupId)) {
      seen.add(groupId);
      result.push({ groupId, via: current });
    }
    current = parentOf(graph, current);
  }
  return result;
}

/**
 * Members of `groupId` that have a strict spec-descendant assigned
 * outside `groupId`'s own subtree — the overlap badge.
 */
export function overlappingMembers(graph: ProjectGraph, groupId: string): string[] {
  const result: string[] = [];
  for (const member of membersOfGroup(graph, groupId)) {
    let conflict = false;
    for (const descendant of subtreeIds(graph, member)) {
      if (descendant === member) continue;
      const assigned = groupOf(graph, descendant);
      if (assigned !== null && !isInSubtreeOf(graph, assigned, groupId)) {
        conflict = true;
        break;
      }
    }
    if (conflict) result.push(member);
  }
  return result;
}

/**
 * True when `nodeId` is a work item no group covers — neither assigned
 * itself nor inheriting an assignment from a spec ancestor. Coverage is
 * ancestor-inherited, so the uncovered set is a clean top-down forest.
 */
export function isUncovered(graph: ProjectGraph, nodeId: string): boolean {
  return coveringGroups(graph, nodeId).length === 0;
}

/** Every uncovered work node (spec items not assigned to any group). */
export function uncoveredWorkIds(graph: ProjectGraph): Set<string> {
  const result = new Set<string>();
  const visit = (id: string): void => {
    if (isUncovered(graph, id)) result.add(id);
    for (const child of childrenOf(graph, id)) visit(child);
  };
  for (const root of rootsOf(graph)) visit(root);
  return result;
}

export interface UncoveredNode {
  id: string;
  children: UncoveredNode[];
}

/**
 * Top-down forest of uncovered spec subtrees. The moment a node is
 * covered, it — and everything under it, which inherits that coverage —
 * is pruned, so a covered node nested inside an otherwise-uncovered
 * subtree (its own direct assignment) still stops that branch.
 */
export function uncoveredForest(graph: ProjectGraph): UncoveredNode[] {
  function visit(id: string): UncoveredNode | null {
    if (!isUncovered(graph, id)) return null;
    const children = childrenOf(graph, id)
      .map(visit)
      .filter((n): n is UncoveredNode => n !== null);
    return { id, children };
  }
  return rootsOf(graph)
    .map(visit)
    .filter((n): n is UncoveredNode => n !== null);
}

/**
 * True when `groupId` is a leaf group (no child groups) with no work
 * items assigned to it — an epic you created but never filled.
 */
export function isEmptyLeafGroup(graph: ProjectGraph, groupId: string): boolean {
  const node = graph.nodes[groupId];
  if (!node || node.type !== 'group') return false;
  if (childrenOf(graph, groupId).length > 0) return false;
  return membersOfGroup(graph, groupId).length === 0;
}

/** The root group above `groupId` in the delivery tree (itself if a root). */
export function rootGroupOf(graph: ProjectGraph, groupId: string): string {
  let current = groupId;
  for (;;) {
    const parent = parentOf(graph, current);
    if (parent === null) return current;
    current = parent;
  }
}
