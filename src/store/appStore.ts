/**
 * The application's single ProjectStore instance plus the React binding.
 * Kept separate from projectStore.ts so the store class stays
 * framework-free and testable under the Node runner.
 */

import { useSyncExternalStore } from 'react';
import { ProjectStore } from './projectStore.ts';
import { ProjectRegistry } from './projectRegistry.ts';
import type { ProjectGraph } from '../model/types.ts';
import type { ProjectIndexEntry } from '../persist/persistence.ts';

export const store = new ProjectStore();

export function useProjectGraph(): ProjectGraph {
  return useSyncExternalStore(store.subscribe, store.getState);
}

/** Placeholder state until `main.tsx` resolves the real startup project
 *  (`resolveStartupProject`) and calls `setActive`/`setProjects` before
 *  first render — same timing as `store.reset` for the graph itself. */
export const projectRegistry = new ProjectRegistry('', []);

export function useActiveProjectId(): string {
  return useSyncExternalStore(projectRegistry.subscribe, projectRegistry.getActiveId);
}

export function useProjects(): ProjectIndexEntry[] {
  return useSyncExternalStore(projectRegistry.subscribe, projectRegistry.getProjects);
}
