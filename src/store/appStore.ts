/**
 * The application's single ProjectStore instance plus the React binding.
 * Kept separate from projectStore.ts so the store class stays
 * framework-free and testable under the Node runner.
 */

import { useSyncExternalStore } from 'react';
import { ProjectStore } from './projectStore.ts';
import type { ProjectGraph } from '../model/types.ts';

export const store = new ProjectStore();

export function useProjectGraph(): ProjectGraph {
  return useSyncExternalStore(store.subscribe, store.getState);
}
