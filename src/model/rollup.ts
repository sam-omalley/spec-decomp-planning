/**
 * Roll-ups over the work-side 'contains' tree, pure. The rule is the
 * scheduling-unit rule shared with the scheduler: a node's own estimate,
 * when set, *is* the answer and its subtree is not descended into (own
 * wins over child sum, no double counting). A node with no own estimate
 * sums its children; an unestimated leaf is a gap.
 */

import type { ProjectGraph } from './types.ts';
import { childrenOf } from './graph.ts';

export interface RolledEstimate {
  /** Effective total: own value if set, else the sum of descendants;
   *  null when nothing under the node is estimated. */
  value: number | null;
  /** True when `value` is the node's own estimate, not a descendant sum. */
  fromOwn: boolean;
  /** True when some contributing leaf in the subtree is unestimated. */
  hasGaps: boolean;
}

/** Generic roll-up parameterised by which own value to read off a node. */
export function rollUp(
  graph: ProjectGraph,
  id: string,
  ownValue: (nodeId: string) => number | null,
): RolledEstimate {
  const own = ownValue(id);
  if (own !== null) return { value: own, fromOwn: true, hasGaps: false };

  const children = childrenOf(graph, id);
  if (children.length === 0) {
    // An unestimated leaf: the scheduler would have nothing to place.
    return { value: null, fromOwn: false, hasGaps: true };
  }

  let sum = 0;
  let anyEstimated = false;
  let hasGaps = false;
  for (const child of children) {
    const rolled = rollUp(graph, child, ownValue);
    if (rolled.value !== null) {
      sum += rolled.value;
      anyEstimated = true;
    }
    if (rolled.hasGaps) hasGaps = true;
  }
  return { value: anyEstimated ? sum : null, fromOwn: false, hasGaps };
}

/** Rolled estimated duration (working days). */
export function rolledDuration(graph: ProjectGraph, id: string): RolledEstimate {
  return rollUp(graph, id, (n) => graph.nodes[n]?.durationEstimate ?? null);
}

/** Rolled estimated size (abstract points). */
export function rolledEffort(graph: ProjectGraph, id: string): RolledEstimate {
  return rollUp(graph, id, (n) => graph.nodes[n]?.effort ?? null);
}

export interface RolledActuals {
  /** Earliest actual start under the node (ISO date), or null. */
  start: string | null;
  /** Latest actual finish under the node (ISO date), or null. */
  finish: string | null;
  /** True when every scheduling unit in the subtree has finished. */
  allDone: boolean;
}

/**
 * Rolled actual dates over the same unit boundary as the estimates: a
 * node with an own estimate (or a leaf) is a unit and contributes its
 * own actuals; otherwise the span is aggregated from children.
 */
export function rolledActuals(graph: ProjectGraph, id: string): RolledActuals {
  const node = graph.nodes[id];
  const children = childrenOf(graph, id);
  const isUnit = (node?.durationEstimate ?? null) !== null || children.length === 0;
  if (isUnit) {
    const finish = node?.actualFinish ?? null;
    return { start: node?.actualStart ?? null, finish, allDone: finish !== null };
  }

  let start: string | null = null;
  let finish: string | null = null;
  let allDone = true;
  for (const child of children) {
    const rolled = rolledActuals(graph, child);
    if (rolled.start !== null && (start === null || rolled.start < start)) {
      start = rolled.start;
    }
    if (rolled.finish !== null && (finish === null || rolled.finish > finish)) {
      finish = rolled.finish;
    }
    if (!rolled.allDone) allDone = false;
  }
  return { start, finish, allDone };
}
