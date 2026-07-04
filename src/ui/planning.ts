/**
 * Pure helpers behind the planning view: which epics cover a node
 * (directly or via a 'contains' ancestor), and which epic members
 * overlap other epics of the same plan (allowed, but badged).
 */

import {
  epicsOfNode,
  epicsOfPlan,
  membersOfEpic,
  parentOf,
  subtreeIds,
} from '../model/graph.ts';
import type { Plan, ProjectGraph } from '../model/types.ts';

export function plansOrdered(graph: ProjectGraph): Plan[] {
  return Object.values(graph.plans).sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

export function epicsOfPlanOrdered(graph: ProjectGraph, planId: string): string[] {
  return epicsOfPlan(graph, planId).sort((a, b) => {
    const na = graph.nodes[a]!;
    const nb = graph.nodes[b]!;
    return na.createdAt.localeCompare(nb.createdAt) || a.localeCompare(b);
  });
}

export interface Coverage {
  epicId: string;
  /** The node carrying the membership edge: `nodeId` itself when the
   * assignment is direct, otherwise the 'contains' ancestor it is
   * inherited from. */
  via: string;
}

/**
 * Epics of `planId` that cover `nodeId`: assigned to the node itself or
 * to any ancestor. Direct assignments come first. One entry per epic
 * (nearest carrier wins if several ancestors are assigned).
 */
export function coveringEpicsInPlan(
  graph: ProjectGraph,
  nodeId: string,
  planId: string,
): Coverage[] {
  const result: Coverage[] = [];
  const seen = new Set<string>();
  let current: string | null = nodeId;
  while (current !== null) {
    for (const epicId of epicsOfNode(graph, current)) {
      if (graph.nodes[epicId]?.planId === planId && !seen.has(epicId)) {
        seen.add(epicId);
        result.push({ epicId, via: current });
      }
    }
    current = parentOf(graph, current);
  }
  return result;
}

/**
 * Members of `epicId` that have a strict descendant assigned to a
 * *different* epic of the same plan — the "overlap" badge. Assignments
 * in other plans never count: a task living in many epics across plans
 * is the normal case, not an overlap.
 */
export function overlappingMembers(graph: ProjectGraph, epicId: string): string[] {
  const planId = graph.nodes[epicId]?.planId;
  if (planId === undefined) return [];
  const result: string[] = [];
  for (const member of membersOfEpic(graph, epicId)) {
    let conflict = false;
    for (const descendant of subtreeIds(graph, member)) {
      if (descendant === member) continue;
      conflict = epicsOfNode(graph, descendant).some(
        (e) => e !== epicId && graph.nodes[e]?.planId === planId,
      );
      if (conflict) break;
    }
    if (conflict) result.push(member);
  }
  return result;
}
