import { useEffect, useRef, useState } from 'react';
import { GraphError } from './model/graph.ts';
import { deserializeProject, serializeProject } from './model/serialize.ts';
import { store, useProjectGraph } from './store/appStore.ts';
import { GraphView } from './ui/GraphView.tsx';
import { MarkdownView } from './ui/MarkdownView.tsx';
import { Outliner } from './ui/Outliner.tsx';
import { PlanningView } from './ui/PlanningView.tsx';
import { MetricsView } from './ui/MetricsView.tsx';
import { SettingsPanel } from './ui/SettingsPanel.tsx';
import { TimelineView } from './ui/TimelineView.tsx';

type View = 'spec' | 'planning' | 'graph' | 'markdown' | 'timeline' | 'metrics';

export function App() {
  const graph = useProjectGraph();
  const [view, setView] = useState<View>('spec');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function exportProject() {
    const blob = new Blob([serializeProject(store.getState())], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `planning-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importProject(file: File) {
    try {
      const imported = deserializeProject(await file.text());
      const hasData = Object.keys(store.getState().nodes).length > 0;
      if (
        hasData &&
        !window.confirm(
          `Open “${file.name}” and replace the current project? ` +
            'The current data and its undo history are discarded.',
        )
      ) {
        return;
      }
      store.reset(imported);
      setSelectedId(null);
    } catch (error) {
      window.alert(
        error instanceof GraphError
          ? `Could not open the file: ${error.message}`
          : 'Could not open the file.',
      );
    }
  }

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
          <button
            className={view === 'graph' ? 'view-tab view-tab-active' : 'view-tab'}
            onClick={() => setView('graph')}
          >
            Graph
          </button>
          <button
            className={view === 'timeline' ? 'view-tab view-tab-active' : 'view-tab'}
            onClick={() => setView('timeline')}
          >
            Timeline
          </button>
          <button
            className={view === 'metrics' ? 'view-tab view-tab-active' : 'view-tab'}
            onClick={() => setView('metrics')}
          >
            Metrics
          </button>
          <button
            className={view === 'markdown' ? 'view-tab view-tab-active' : 'view-tab'}
            onClick={() => setView('markdown')}
          >
            Markdown
          </button>
        </nav>
        <span className="app-count">
          {itemCount} item{itemCount === 1 ? '' : 's'}
        </span>
        <div className="app-spacer" />
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importProject(file);
          }}
        />
        <button onClick={() => fileInputRef.current?.click()} title="Open a project .json">
          Open…
        </button>
        <button onClick={exportProject} title="Download the project as .json">
          Save…
        </button>
        <span className="header-divider" />
        <SettingsPanel />
        <span className="header-divider" />
        <button disabled={!store.canUndo} onClick={() => store.undo()} title="⌘Z">
          ↩ Undo
        </button>
        <button disabled={!store.canRedo} onClick={() => store.redo()} title="⇧⌘Z">
          ↪ Redo
        </button>
      </header>
      <main className={`app-main${view === 'spec' ? '' : ' app-main-wide'}`}>
        {view === 'spec' && <Outliner selectedId={selectedId} onSelect={setSelectedId} />}
        {view === 'planning' && (
          <PlanningView selectedId={selectedId} onSelect={setSelectedId} />
        )}
        {view === 'graph' && (
          <GraphView selectedId={selectedId} onSelect={setSelectedId} />
        )}
        {view === 'timeline' && (
          <TimelineView selectedId={selectedId} onSelect={setSelectedId} />
        )}
        {view === 'metrics' && <MetricsView />}
        {view === 'markdown' && <MarkdownView />}
      </main>
      <footer className="app-hints">
        {view === 'spec' && (
          <>
            Enter sibling · ⇧Enter / Enter at line start = insert above · Tab indent · ⇧Tab
            outdent · ⌥↑↓ move · ⌘. fold · ⌘↩ details · ⌫ on empty / ⌘⌫ delete · paste
            multi-line text to add rows · ⇧/⌘-click or ⇧↑↓ multi-selects a run to
            indent/move/delete together · ⌘Z undo · the spec is structural — estimate &amp;
            track in the Plan
          </>
        )}
        {view === 'planning' && (
          <>
            Outline / Table toggle · groups edit like the outliner (Enter · ⇧Enter above ·
            Tab · ⌥↑↓ · ⌘↩ details, estimates, dependencies) · paste &amp; ⇧/⌘-click
            multi-select work here too · bullet click = status · Table edits every plan field
            (bulk-set across a selection) · drag spec items onto groups for traceability ·
            drop moves, drag to spec pane or × unassigns · Unassigned filter finds uncovered
            work
          </>
        )}
        {view === 'graph' && (
          <>Spec on the left, delivery on the right, assignments bridge the middle · click
            selects · scroll zooms · drag a spec node onto a group to assign · toggle
            Unassigned / Empty filters, spotlight or hide the rest</>
        )}
        {view === 'timeline' && (
          <>Plan schedule as a Gantt · bars per delivery group, containers span their units ·
            ▸ projected finish, 🎯 target date · solid = actual, lighter = planned · set dates
            &amp; capacity in ⚙ Settings</>
        )}
        {view === 'metrics' && (
          <>Projection summary, burn-up and estimate-vs-actual · figures roll up from the
            plan&apos;s scheduling units · set a target date in ⚙ Settings for variance</>
        )}
        {view === 'markdown' && (
          <>The delivery plan as Markdown · toggle sections · Copy to export · read-only</>
        )}
      </footer>
    </div>
  );
}
