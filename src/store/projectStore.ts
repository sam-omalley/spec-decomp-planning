/**
 * Observable store around a ProjectGraph — the undo/redo, coalescing and
 * notification behaviour lives in the generic `SnapshotStore`
 * (snapshotStore.ts); this adds only the graph's own defaults and types.
 *
 * See snapshotStore.ts for the commit/undo contract: one commit = one undo
 * step, a throwing mutation leaves state and history untouched, and
 * consecutive commits sharing a `coalesce` key collapse into one step.
 */

import { emptyGraph } from '../model/graph.ts';
import type { ProjectGraph } from '../model/types.ts';
import { SnapshotStore } from './snapshotStore.ts';

export type { CommitOptions } from './snapshotStore.ts';

export type Mutation = (graph: ProjectGraph) => ProjectGraph;

export class ProjectStore extends SnapshotStore<ProjectGraph> {
  constructor(initial?: ProjectGraph) {
    super(initial ?? emptyGraph());
  }
}
