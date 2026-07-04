import { useEffect, useState } from 'react';
import { store, useProjectGraph } from './store/appStore.ts';
import { Outliner } from './ui/Outliner.tsx';
import { PlanningView } from './ui/PlanningView.tsx';
import { plansOrdered } from './ui/planning.ts';

type View = 'spec' | 'planning';

export function App() {
  const graph = useProjectGraph();
  const [view, setView] = useState<View>('spec');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);

  const itemCount = Object.values(graph.nodes).filter((n) => n.type !== 'epic').length;

  // Selection and active plan are view state; heal them when the
  // underlying graph entry disappears (delete, undo, plan removal).
  useEffect(() => {
    if (selectedId !== null && !graph.nodes[selectedId]) setSelectedId(null);
    if (activePlanId === null || !graph.plans[activePlanId]) {
      setActivePlanId(plansOrdered(graph)[0]?.id ?? null);
    }
  }, [graph, selectedId, activePlanId]);

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
          <PlanningView
            activePlanId={activePlanId}
            onSwitchPlan={setActivePlanId}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}
      </main>
      <footer className="app-hints">
        {view === 'spec' ? (
          <>
            Enter sibling · Tab indent · ⇧Tab outdent · ⌥↑↓ move · ⌘. fold · ⌫ on empty /
            ⌘⌫ delete · ⌘Z undo
          </>
        ) : (
          <>Drag spec items onto epics · drag chips between epics · × removes an assignment</>
        )}
      </footer>
    </div>
  );
}
