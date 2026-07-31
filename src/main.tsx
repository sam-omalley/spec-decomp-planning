import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { projectRegistry, store } from './store/appStore.ts';
import { deserializeProjectWithReport, serializeProject } from './model/serialize.ts';
import {
  createAutosaver,
  createProjectId,
  listProjects,
  loadEngagementText,
  resolveStartupProject,
  saveEngagementText,
  saveProjectText,
  saveUnrecoveredEngagementText,
  saveUnrecoveredText,
  setCurrentProjectId,
} from './persist/persistence.ts';
import { engagementStore } from './engagement/store.ts';
import { deserializeWorkspace, serializeWorkspace } from './engagement/serialize.ts';
import { setPendingLoadRepairs } from './persist/loadReport.ts';
import './styles.css';

async function init(): Promise<void> {
  // Load before the first render so nothing the user types can race
  // the autosaved project. Resolves which project id is "current" (running
  // the one-time pre-#134 migration if needed) and its content in one go.
  let activeId: string | null = null;
  try {
    const startup = await resolveStartupProject();
    if (startup !== null) {
      activeId = startup.id;
      try {
        const { graph, repairs } = deserializeProjectWithReport(startup.text);
        setPendingLoadRepairs(repairs);
        store.reset(graph);
      } catch (parseError) {
        // The autosave exists but couldn't be read (corrupt, or from an
        // unsupported version). Never silently discard it: back it up under
        // a separate key — out of the autosaver's reach — before the app
        // falls back to an empty project, so the next edit's autosave can't
        // overwrite the only copy. A console warning alone is invisible;
        // this is otherwise silent, permanent data loss, so alert loudly.
        await saveUnrecoveredText(startup.text).catch(() => {});
        console.warn('Could not load the autosaved project:', parseError);
        window.alert(
          'Your saved project could not be loaded, so the app is starting ' +
            'from an empty project. Nothing has been deleted — the ' +
            'unreadable data was kept as a backup; use "Recover backup" in ' +
            'the header to download it.',
        );
      }
    }
  } catch (error) {
    // resolveStartupProject() itself failed (e.g. IndexedDB unavailable) —
    // there's no raw text to back up here.
    console.warn('Could not load the autosaved project:', error);
  }
  if (activeId === null) {
    // A genuinely fresh install (or a dangling `current` pointer) — mint an
    // id now so the very first autosave has somewhere to land, and the
    // switcher shows this project from the start once it's named.
    activeId = createProjectId();
    await setCurrentProjectId(activeId).catch(() => {});
  }
  projectRegistry.setActive(activeId);
  projectRegistry.setProjects(await listProjects().catch(() => []));

  // The engagement tracker (#163) is workspace-scoped: one record, loaded
  // once, independent of which project is active. Same
  // back-up-rather-than-discard rule as the project autosave — an
  // unreadable record is kept under its own key instead of being replaced
  // by the next save of an empty tracker.
  try {
    const text = await loadEngagementText();
    if (text !== undefined) {
      try {
        engagementStore.reset(deserializeWorkspace(text));
      } catch (parseError) {
        await saveUnrecoveredEngagementText(text).catch(() => {});
        console.warn('Could not load the engagement tracker:', parseError);
      }
    }
  } catch (error) {
    console.warn('Could not load the engagement tracker:', error);
  }

  const autosaver = createAutosaver({
    subscribe: store.subscribe,
    getState: store.getState,
    serialize: (graph) => serializeProject(graph),
    save: (text) => saveProjectText(projectRegistry.getActiveId(), text),
    onError: (error) => console.warn('Autosave failed:', error),
  });
  const engagementAutosaver = createAutosaver({
    subscribe: engagementStore.subscribe,
    getState: engagementStore.getState,
    serialize: (workspace) => serializeWorkspace(workspace),
    save: (text) => saveEngagementText(text),
    onError: (error) => console.warn('Engagement autosave failed:', error),
  });
  // Debounce means the last ~300ms could be unsaved when the tab goes
  // away; flush while the page can still complete an IndexedDB write.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      autosaver.flush();
      engagementAutosaver.flush();
    }
  });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void init();
