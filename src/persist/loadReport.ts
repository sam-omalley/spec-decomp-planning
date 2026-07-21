/**
 * Transient handoff for repairs `deserializeProjectWithReport` made while
 * loading the autosave in `main.tsx`, which runs (and finishes) before
 * `App` mounts — there is no React state to put this in yet. `App`'s
 * mount effect takes it once and shows a banner; nothing else reads it,
 * so it isn't persisted anywhere.
 */

import type { GraphRepair } from '../model/serialize.ts';

let pending: GraphRepair[] | null = null;

export function setPendingLoadRepairs(repairs: GraphRepair[]): void {
  pending = repairs.length > 0 ? repairs : null;
}

export function takePendingLoadRepairs(): GraphRepair[] | null {
  const repairs = pending;
  pending = null;
  return repairs;
}
