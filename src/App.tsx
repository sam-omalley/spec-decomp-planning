import { useEffect, useState } from 'react';
import { store, useProjectGraph } from './store/appStore.ts';
import { Outliner } from './ui/Outliner.tsx';
import { PlanningView } from './ui/PlanningView.tsx';

type View = 'spec' | 'planning';

export function App() {
  const graph = useProjectGraph();
  const [view, setView] = useState<View>('spec');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const itemCount = Object.values(graph.nodes).filter((n) => n.type !== 'group').length;

  // Selection is view state; heal it when the node disappears
  // (delete, undo).
  useEffect(() => {
    if (selectedId !== null && !graph.nodes[selectedId]) setSelectedId(null);
  }, [graph, selectedId]);

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
        <nav className="view-tabs">
          <button
            className={view === 'spec' ? 'view-tab view-tab-active' : 'view-tab'}
            onClick={() => setView('spec')}
          >
            Spec
          </button>
          <button
            className={view === 'planning' ? 'view-tab view-tab-active' : 'view-tab'}
            onClick={() => setView('planning')}
          >
            Planning
          </button>
        </nav>
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
      <main className={`app-main${view === 'planning' ? ' app-main-wide' : ''}`}>
        {view === 'spec' ? (
          <Outliner selectedId={selectedId} onSelect={setSelectedId} />
        ) : (
          <PlanningView selectedId={selectedId} onSelect={setSelectedId} />
        )}
      </main>
      <footer className="app-hints">
        {view === 'spec' ? (
          <>
            Enter sibling · Tab indent · ⇧Tab outdent · ⌥↑↓ move · ⌘. fold · ⌘↩ details ·
            ⌫ on empty / ⌘⌫ delete · ⌘Z undo
          </>
        ) : (
          <>
            Groups edit like the outliner (Enter · Tab · ⌥↑↓ · ⌘↩ details) · drag spec items
            onto groups · drop moves, drag to spec pane or × unassigns
          </>
        )}
      </footer>
    </div>
  );
}
