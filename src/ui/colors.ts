/**
 * Group colors, shared by the planning and graph views: every root
 * group gets a stable palette color, and nested groups inherit their
 * root's color so a block and its epics read as one family.
 */

import { groupRootsOf } from '../model/graph.ts';
import type { ProjectGraph } from '../model/types.ts';
import { rootGroupOf } from './planning.ts';

export const GROUP_COLORS = [
  '#4667d4',
  '#0e9f6e',
  '#c2410c',
  '#8a63d2',
  '#0e8fa5',
  '#b42318',
  '#a16207',
  '#be3a8f',
];

export function rootGroupColor(graph: ProjectGraph, groupId: string): string {
  const index = groupRootsOf(graph).indexOf(rootGroupOf(graph, groupId));
  return GROUP_COLORS[(index < 0 ? 0 : index) % GROUP_COLORS.length]!;
}
