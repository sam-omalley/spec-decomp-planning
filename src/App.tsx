import { useEffect, useMemo, useRef, useState } from 'react';
import { GraphError } from './model/graph.ts';
import { deserializeProject, serializeProject } from './model/serialize.ts';
import { store, useProjectGraph } from './store/appStore.ts';
import { GraphView, type GraphMode } from './ui/GraphView.tsx';
import { MarkdownView } from './ui/MarkdownView.tsx';
import { Outliner } from './ui/Outliner.tsx';
import { PlanningView } from './ui/PlanningView.tsx';
import { MetricsView } from './ui/MetricsView.tsx';
import { SettingsPanel } from './ui/SettingsPanel.tsx';
import { TimelineView } from './ui/TimelineView.tsx';
import { isFilterActive, matchesFilter, type FilterState } from './ui/filter.ts';

type View = 'spec' | 'planning' | 'graph' | 'markdown' | 'timeline' | 'metrics';

export function App() {
  const graph = useProjectGraph();
  const [view, setView] = useState<View>('spec');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Lifted so the footer hint can follow the Planning sub-view.
  const [planMode, setPlanMode] = useState<'outline' | 'table'>('outline');
  // Likewise the Graph tab's Map/Dependency mode drives its footer hint.
  const [graphMode, setGraphMode] = useState<GraphMode>('map');
  // Global filter/search — view state only; never enters the graph, undo,
  // or autosave. Shared across the Spec / Planning / Graph tabs.
  const [filterText, setFilterText] = useState('');
  // Per-side depth caps (undefined = all levels); ephemeral view state,
  // like planMode — never serialized.
  const [specMaxDepth, setSpecMaxDepth] = useState<number | undefined>(undefined);
  const [planMaxDepth, setPlanMaxDepth] = useState<number | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filter: FilterState = useMemo(() => ({ text: filterText }), [filterText]);
  const filterActive = isFilterActive(filter);
  // Views the filter applies to; others are left unchanged.
  const searchable = view === 'spec' || view === 'planning' || view === 'graph';
  const matchCount = useMemo(() => {
    if (!filterActive || !searchable) return 0;
    return Object.values(graph.nodes).filter((n) => {
      if (!matchesFilter(n, filter)) return false;
      // Spec shows only work nodes; the Planning table shows only groups.
      if (view === 'spec') return n.type !== 'group';
      if (view === 'planning' && planMode === 'table') return n.type === 'group';
      return true;
    }).length;
  }, [filterActive, searchable, graph, filter, view, planMode]);

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
        {searchable && (
          <div className="app-search">
            <input
              type="search"
              className="app-search-input"
              placeholder="Filter…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setFilterText('');
                  e.currentTarget.blur();
                }
              }}
            />
            {filterActive && (
              <span className="app-search-count">
                {matchCount} match{matchCount === 1 ? '' : 'es'}
              </span>
            )}
          </div>
        )}
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
        {view === 'spec' && (
          <Outliner
            selectedId={selectedId}
            onSelect={setSelectedId}
            filter={filter}
            maxDepth={specMaxDepth}
            onMaxDepthChange={setSpecMaxDepth}
          />
        )}
        {view === 'planning' && (
          <PlanningView
            selectedId={selectedId}
            onSelect={setSelectedId}
            mode={planMode}
            onModeChange={setPlanMode}
            filter={filter}
            maxDepth={planMaxDepth}
            onMaxDepthChange={setPlanMaxDepth}
          />
        )}
        {view === 'graph' && (
          <GraphView
            selectedId={selectedId}
            onSelect={setSelectedId}
            filter={filter}
            mode={graphMode}
            onModeChange={setGraphMode}
          />
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
            <kbd>Enter</kbd> new row · <kbd>Tab</kbd> / <kbd>⇧Tab</kbd> nest · <kbd>⌘↩</kbd>{' '}
            details · paste lines or <kbd>⇧</kbd>-click to edit in bulk
          </>
        )}
        {view === 'planning' && planMode === 'table' && (
          <>Click a field to edit · <kbd>⇧</kbd>-click rows to bulk-set · parent rows show
            rolled-up totals</>
        )}
        {view === 'planning' && planMode === 'outline' && (
          <>
            <kbd>Enter</kbd> new group · <kbd>Tab</kbd> nest · bullet = status · <kbd>⌘↩</kbd>{' '}
            estimates &amp; dependencies · drag spec items on to assign
          </>
        )}
        {view === 'graph' && graphMode === 'map' && (
          <>Click to select · scroll to zoom · drag a spec node onto a group to assign</>
        )}
        {view === 'graph' && graphMode === 'dep' && (
          <>Drag from a story's handle onto the one it needs · click an arrow to remove · scroll
            to zoom</>
        )}
        {view === 'timeline' && (
          <>Plan schedule as a Gantt · ▸ projected finish · 🎯 target date · set dates &amp;
            capacity in ⚙ Settings</>
        )}
        {view === 'metrics' && (
          <>Projection, burn-up &amp; estimate-vs-actual · set a target date in ⚙ Settings for
            variance</>
        )}
        {view === 'markdown' && (
          <>The delivery plan as Markdown · toggle sections · Copy to export</>
        )}
      </footer>
    </div>
  );
}
