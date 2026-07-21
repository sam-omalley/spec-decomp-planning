import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { store } from './store/appStore.ts';
import { deserializeProjectWithReport, serializeProject } from './model/serialize.ts';
import {
  createAutosaver,
  loadProjectText,
  saveProjectText,
  saveUnrecoveredText,
} from './persist/persistence.ts';
import { setPendingLoadRepairs } from './persist/loadReport.ts';
import './styles.css';

async function init(): Promise<void> {
  // Load before the first render so nothing the user types can race
  // the autosaved project.
  try {
    const text = await loadProjectText();
    if (text !== undefined) {
      try {
        const { graph, repairs } = deserializeProjectWithReport(text);
        setPendingLoadRepairs(repairs);
        store.reset(graph);
      } catch (parseError) {
        // The autosave exists but couldn't be read (corrupt, or from an
        // unsupported version). Never silently discard it: back it up under
        // a separate key — out of the autosaver's reach — before the app
        // falls back to an empty project, so the next edit's autosave can't
        // overwrite the only copy. A console warning alone is invisible;
        // this is otherwise silent, permanent data loss, so alert loudly.
        await saveUnrecoveredText(text).catch(() => {});
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
    // loadProjectText() itself failed (e.g. IndexedDB unavailable) — there's
    // no raw text to back up here.
    console.warn('Could not load the autosaved project:', error);
  }

  const autosaver = createAutosaver({
    subscribe: store.subscribe,
    getState: store.getState,
    serialize: (graph) => serializeProject(graph),
    save: saveProjectText,
    onError: (error) => console.warn('Autosave failed:', error),
  });
  // Debounce means the last ~300ms could be unsaved when the tab goes
  // away; flush while the page can still complete an IndexedDB write.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') autosaver.flush();
  });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void init();
