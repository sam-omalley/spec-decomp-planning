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
  groupOf,
  isInSubtreeOf,
  membersOfGroup,
  parentOf,
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

/** The root group above `groupId` in the delivery tree (itself if a root). */
export function rootGroupOf(graph: ProjectGraph, groupId: string): string {
  let current = groupId;
  for (;;) {
    const parent = parentOf(graph, current);
    if (parent === null) return current;
    current = parent;
  }
}
