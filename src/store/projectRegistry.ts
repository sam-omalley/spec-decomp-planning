/**
 * Framework-free observable registry of known projects (#134) — the
 * multi-project counterpart to `ProjectStore`. Kept separate from the
 * graph store itself: switching projects replaces `store`'s whole state
 * via `store.reset`, but this is what the header switcher and Settings'
 * Projects card render their list from, and what the autosaver (main.tsx,
 * outside React) reads to know which id to save the current graph under.
 */

import type { ProjectIndexEntry } from '../persist/persistence.ts';

export class ProjectRegistry {
  #activeId: string;
  #projects: ProjectIndexEntry[];
  #listeners = new Set<() => void>();

  constructor(activeId: string, projects: ProjectIndexEntry[]) {
    this.#activeId = activeId;
    this.#projects = projects;
  }

  getActiveId = (): string => this.#activeId;
  getProjects = (): ProjectIndexEntry[] => this.#projects;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Points the registry at a different project — called once the graph
   *  store itself has been (or is about to be) reset to that project's
   *  content. */
  setActive(id: string): void {
    this.#activeId = id;
    this.#notify();
  }

  /** Replaces the known project list (after a create/rename/duplicate/
   *  delete), most-recently-saved first — see `listProjects`. */
  setProjects(projects: ProjectIndexEntry[]): void {
    this.#projects = projects;
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
