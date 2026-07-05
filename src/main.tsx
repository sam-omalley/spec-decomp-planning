import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { store } from './store/appStore.ts';
import { deserializeProject, serializeProject } from './model/serialize.ts';
import {
  createAutosaver,
  loadProjectText,
  saveProjectText,
} from './persist/persistence.ts';
import './styles.css';

async function init(): Promise<void> {
  // Load before the first render so nothing the user types can race
  // the autosaved project.
  try {
    const text = await loadProjectText();
    if (text !== undefined) store.reset(deserializeProject(text));
  } catch (error) {
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
