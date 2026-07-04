import { useEffect } from 'react';
import { store, useProjectGraph } from './store/appStore.ts';
import { Outliner } from './ui/Outliner.tsx';

export function App() {
  const graph = useProjectGraph();
  const itemCount = Object.values(graph.nodes).filter((n) => n.type !== 'epic').length;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
      } else if (key === 'y') {
        event.preventDefault();
        store.redo();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Planning Tool</h1>
        <span className="app-count">
          {itemCount} item{itemCount === 1 ? '' : 's'}
        </span>
        <div className="app-spacer" />
        <button disabled={!store.canUndo} onClick={() => store.undo()} title="⌘Z">
          ↩ Undo
        </button>
        <button disabled={!store.canRedo} onClick={() => store.redo()} title="⇧⌘Z">
          ↪ Redo
        </button>
      </header>
      <main className="app-main">
        <Outliner />
      </main>
      <footer className="app-hints">
        Enter sibling · Tab indent · ⇧Tab outdent · ⌥↑↓ move · ⌘. fold · ⌫ on empty /
        ⌘⌫ delete · ⌘Z undo
      </footer>
    </div>
  );
}
