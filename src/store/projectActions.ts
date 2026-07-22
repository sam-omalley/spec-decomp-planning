/**
 * Multi-project orchestration (#134): switch / create / duplicate / rename /
 * delete, each touching both the graph store (`store`) and the project
 * registry (`projectRegistry`) plus IndexedDB (`src/persist/persistence.ts`).
 * Shared by the header switcher and Settings' Projects card so neither
 * duplicates this async choreography. UI concerns (confirm/prompt dialogs,
 * error alerts) stay in the calling components — these functions are pure
 * orchestration and throw on a bad load, same as `deserializeProjectWithReport`.
 */

import { emptyGraph } from '../model/graph.ts';
import { deserializeProjectWithReport, serializeProject, type GraphRepair } from '../model/serialize.ts';
import type { ProjectGraph } from '../model/types.ts';
import {
  createProjectId,
  deleteProject,
  listProjects,
  loadProjectText,
  renameProject,
  saveProjectText,
  setCurrentProjectId,
  type ProjectIndexEntry,
} from '../persist/persistence.ts';
import { projectRegistry, store } from './appStore.ts';

/** Persists the active project's current live state immediately, bypassing
 *  the autosaver's debounce — used before any action that navigates away
 *  from it, so the last edits are never lost to a 300ms window. */
async function persistActiveNow(): Promise<void> {
  const id = projectRegistry.getActiveId();
  if (!id) return;
  await saveProjectText(id, serializeProject(store.getState()));
}

async function refreshProjects(): Promise<ProjectIndexEntry[]> {
  const projects = await listProjects();
  projectRegistry.setProjects(projects);
  return projects;
}

async function activate(id: string, graph: ProjectGraph): Promise<void> {
  await setCurrentProjectId(id);
  projectRegistry.setActive(id);
  store.reset(graph);
}

/** Switches to a different, already-known project. No-op if it's already
 *  active. Throws (like `deserializeProjectWithReport`) if its stored
 *  content is corrupt. */
export async function switchProject(id: string): Promise<{ repairs: GraphRepair[] }> {
  if (id === projectRegistry.getActiveId()) return { repairs: [] };
  await persistActiveNow();
  const text = await loadProjectText(id);
  const { graph, repairs } = deserializeProjectWithReport(text ?? serializeProject(emptyGraph()));
  await activate(id, graph);
  return { repairs };
}

/** Creates a new, empty project and switches to it. */
export async function createNewProject(name?: string): Promise<void> {
  await persistActiveNow();
  const id = createProjectId();
  const graph = emptyGraph();
  await saveProjectText(id, serializeProject(graph));
  if (name && name.trim()) await renameProject(id, name.trim());
  await activate(id, graph);
  await refreshProjects();
}

/** Copies the active project's current live state into a new independent
 *  project and switches to it — the cheap way to try a structural
 *  what-if next to the real plan. */
export async function duplicateActiveProject(name?: string): Promise<void> {
  const sourceId = projectRegistry.getActiveId();
  const sourceEntry = projectRegistry.getProjects().find((p) => p.id === sourceId);
  const graph = store.getState();
  const newId = createProjectId();
  await saveProjectText(newId, serializeProject(graph));
  const finalName = (name && name.trim()) || `${sourceEntry?.name ?? 'Untitled'} copy`;
  await renameProject(newId, finalName);
  // The live graph *is* the duplicate's content already — no need to
  // reload it from IndexedDB, just repoint at it with fresh undo history.
  await activate(newId, graph);
  await refreshProjects();
}

export async function renameActiveOrOtherProject(id: string, name: string): Promise<void> {
  await renameProject(id, name);
  await refreshProjects();
}

/** Deletes a project. If it was the active one, switches to the
 *  most-recently-saved remaining project, or — if it was the only one —
 *  mints a fresh empty project so something is always open. */
export async function deleteProjectAction(id: string): Promise<void> {
  const wasActive = id === projectRegistry.getActiveId();
  await deleteProject(id);
  const remaining = await listProjects();
  if (wasActive) {
    const next = remaining[0];
    if (next) {
      const text = await loadProjectText(next.id);
      const { graph } = deserializeProjectWithReport(text ?? serializeProject(emptyGraph()));
      await activate(next.id, graph);
    } else {
      const newId = createProjectId();
      const graph = emptyGraph();
      await saveProjectText(newId, serializeProject(graph));
      await activate(newId, graph);
    }
  }
  await refreshProjects();
}
