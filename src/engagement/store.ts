/**
 * The engagement workspace's store (#163) — the same `SnapshotStore` the
 * project graph uses, over the tracker's own state, plus the React binding.
 *
 * Deliberately a *second* store instance rather than more state inside the
 * project store: the tracker is workspace-scoped, so switching projects must
 * not switch (or undo, or autosave over) your stakeholders. Its undo history
 * is its own for the same reason — ⌘Z in the Agenda view should not roll
 * back an edit you made in the plan.
 */

import { useSyncExternalStore } from 'react';
import { SnapshotStore } from '../store/snapshotStore.ts';
import { emptyWorkspace } from './workspace.ts';
import type { Workspace } from './types.ts';

export class EngagementStore extends SnapshotStore<Workspace> {
  constructor(initial?: Workspace) {
    super(initial ?? emptyWorkspace());
  }
}

export const engagementStore = new EngagementStore();

export function useWorkspace(): Workspace {
  return useSyncExternalStore(engagementStore.subscribe, engagementStore.getState);
}
