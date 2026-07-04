/**
 * Framework-free observable store around a ProjectGraph.
 *
 * Undo/redo is snapshot-based: every commit pushes the previous graph
 * onto the undo stack. Because all mutations in model/graph.ts are
 * immutable with structural sharing, a "snapshot" is just an object
 * reference — history costs O(changes), not O(state).
 *
 * One commit = one undo step. A commit callback may compose several
 * mutations (e.g. remove from one epic + add to another) and they will
 * undo atomically.
 *
 * React binding (later slice) is useSyncExternalStore(store.subscribe,
 * store.getState) — no state library needed.
 */

import { emptyGraph } from '../model/graph.ts';
import type { ProjectGraph } from '../model/types.ts';

const HISTORY_LIMIT = 200;

export type Mutation = (graph: ProjectGraph) => ProjectGraph;

export class ProjectStore {
  #state: ProjectGraph;
  #undoStack: ProjectGraph[] = [];
  #redoStack: ProjectGraph[] = [];
  #listeners = new Set<() => void>();

  constructor(initial?: ProjectGraph) {
    this.#state = initial ?? emptyGraph();
  }

  getState = (): ProjectGraph => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /**
   * Applies a mutation as a single undoable step. If the mutation throws,
   * state and history are unchanged. Returns the new graph.
   */
  commit(mutate: Mutation): ProjectGraph {
    const next = mutate(this.#state);
    if (next === this.#state) return next;
    this.#undoStack.push(this.#state);
    if (this.#undoStack.length > HISTORY_LIMIT) this.#undoStack.shift();
    this.#redoStack = [];
    this.#state = next;
    this.#notify();
    return next;
  }

  /** Replaces the whole project (file load). Clears history. */
  reset(graph: ProjectGraph): void {
    this.#state = graph;
    this.#undoStack = [];
    this.#redoStack = [];
    this.#notify();
  }

  get canUndo(): boolean {
    return this.#undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.#redoStack.length > 0;
  }

  undo(): boolean {
    const previous = this.#undoStack.pop();
    if (!previous) return false;
    this.#redoStack.push(this.#state);
    this.#state = previous;
    this.#notify();
    return true;
  }

  redo(): boolean {
    const next = this.#redoStack.pop();
    if (!next) return false;
    this.#undoStack.push(this.#state);
    this.#state = next;
    this.#notify();
    return true;
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
