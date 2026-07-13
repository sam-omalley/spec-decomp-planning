import { useEffect, useMemo, useRef, useState } from 'react';
import { GraphError } from './model/graph.ts';
import { deserializeProject, serializeProject } from './model/serialize.ts';
import { store, useProjectGraph } from './store/appStore.ts';
import { GraphView, type GraphMode } from './ui/GraphView.tsx';
import { MarkdownView } from './ui/MarkdownView.tsx';
import { Outliner } from './ui/Outliner.tsx';
import { PlanningView } from './ui/PlanningView.tsx';
import { MetricsView } from './ui/MetricsView.tsx';
import { AssigneeMetricsView } from './ui/AssigneeMetricsView.tsx';
import { ConcernsView } from './ui/ConcernsView.tsx';
import { SettingsPanel } from './ui/SettingsPanel.tsx';
import { TimelineView } from './ui/TimelineView.tsx';
import { isFilterActive, matchesFilter, type FilterState } from './ui/filter.ts';

// Top-level sections; each groups one or more sub-views (see the sub-tab
// bars below). Markdown lives under Planning; Timeline/Metrics/Concerns
// under Reporting.
type Section = 'spec' | 'planning' | 'graph' | 'reporting';
type PlanMode = 'outline' | 'table' | 'markdown';
type ReportMode = 'timeline' | 'metrics' | 'assignees' | 'concerns';

const SECTION_LABELS: Record<Section, string> = {
  spec: 'Spec',
  planning: 'Planning',
  graph: 'Graph',
  reporting: 'Reporting',
};

export function App() {
  const graph = useProjectGraph();
  const [section, setSection] = useState<Section>('spec');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Sub-view within each section; lifted so the sub-tab bar and footer hint
  // can follow it. Markdown is a Planning sub-view now.
  const [planMode, setPlanMode] = useState<PlanMode>('outline');
  const [graphMode, setGraphMode] = useState<GraphMode>('map');
  const [reportMode, setReportMode] = useState<ReportMode>('timeline');
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
  // Views the filter applies to; others (Markdown, Reporting) are unchanged.
  const searchable =
    section === 'spec' ||
    (section === 'planning' && planMode !== 'markdown') ||
    section === 'graph';
  const matchCount = useMemo(() => {
    if (!filterActive || !searchable) return 0;
    return Object.values(graph.nodes).filter((n) => {
      if (!matchesFilter(n, filter)) return false;
      // Spec shows only work nodes; the Planning table shows only groups.
      if (section === 'spec') return n.type !== 'group';
      if (section === 'planning' && planMode === 'table') return n.type === 'group';
      return true;
    }).length;
  }, [filterActive, searchable, graph, filter, section, planMode]);

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

  // Jump from a read-only view (Table, Metrics, Timeline) to a node's home
  // surface and select it: groups live in the Planning outline (where the
  // full title, details and dependencies open), work nodes in the Spec view.
  function reveal(id: string) {
    const node = store.getState().nodes[id];
    if (!node) return;
    setSelectedId(id);
    if (node.type === 'group') {
      setPlanMode('outline');
      setSection('planning');
    } else {
      setSection('spec');
    }
  }

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
        <nav className="view-tabs" aria-label="Section">
          {(Object.keys(SECTION_LABELS) as Section[]).map((s) => (
            <button
              key={s}
              className={section === s ? 'view-tab view-tab-active' : 'view-tab'}
              onClick={() => setSection(s)}
            >
              {SECTION_LABELS[s]}
            </button>
          ))}
        </nav>
        {section === 'planning' && (
          <SubTabs
            label="Planning view"
            options={[
              ['outline', 'Outline'],
              ['table', 'Table'],
              ['markdown', 'Markdown'],
            ]}
            active={planMode}
            onSelect={setPlanMode}
          />
        )}
        {section === 'graph' && (
          <SubTabs
            label="Graph view"
            options={[
              ['map', 'Map'],
              ['dep', 'Dependency'],
            ]}
            active={graphMode}
            onSelect={setGraphMode}
          />
        )}
        {section === 'reporting' && (
          <SubTabs
            label="Report"
            options={[
              ['timeline', 'Timeline'],
              ['metrics', 'Metrics'],
              ['assignees', 'Assignees'],
              ['concerns', 'Concerns'],
            ]}
            active={reportMode}
            onSelect={setReportMode}
          />
        )}
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
      <main className={`app-main${section === 'spec' ? '' : ' app-main-wide'}`}>
        {section === 'spec' && (
          <Outliner
            selectedId={selectedId}
            onSelect={setSelectedId}
            filter={filter}
            maxDepth={specMaxDepth}
            onMaxDepthChange={setSpecMaxDepth}
          />
        )}
        {section === 'planning' && planMode !== 'markdown' && (
          <PlanningView
            selectedId={selectedId}
            onSelect={setSelectedId}
            mode={planMode}
            filter={filter}
            maxDepth={planMaxDepth}
            onMaxDepthChange={setPlanMaxDepth}
            onReveal={reveal}
          />
        )}
        {section === 'planning' && planMode === 'markdown' && <MarkdownView />}
        {section === 'graph' && (
          <GraphView
            selectedId={selectedId}
            onSelect={setSelectedId}
            filter={filter}
            mode={graphMode}
          />
        )}
        {section === 'reporting' && reportMode === 'timeline' && (
          <TimelineView selectedId={selectedId} onSelect={setSelectedId} onReveal={reveal} />
        )}
        {section === 'reporting' && reportMode === 'metrics' && <MetricsView onReveal={reveal} />}
        {section === 'reporting' && reportMode === 'assignees' && <AssigneeMetricsView />}
        {section === 'reporting' && reportMode === 'concerns' && <ConcernsView onReveal={reveal} />}
      </main>
      <footer className="app-hints">
        {section === 'spec' && (
          <>
            <kbd>Enter</kbd> new row · <kbd>Tab</kbd> / <kbd>⇧Tab</kbd> nest · <kbd>⌘↩</kbd>{' '}
            details · paste lines or <kbd>⇧</kbd>-click to edit in bulk
          </>
        )}
        {section === 'planning' && planMode === 'table' && (
          <>Click a field to edit · <kbd>⇧</kbd>-click rows to bulk-set · <kbd>⤢</kbd> opens the
            outline · parent rows show rolled-up totals</>
        )}
        {section === 'planning' && planMode === 'outline' && (
          <>
            <kbd>Enter</kbd> new group · <kbd>Tab</kbd> nest · bullet = status · <kbd>⌘↩</kbd>{' '}
            estimates &amp; dependencies · drag spec items on to assign
          </>
        )}
        {section === 'planning' && planMode === 'markdown' && (
          <>The delivery plan as Markdown · toggle sections · Copy to export</>
        )}
        {section === 'graph' && graphMode === 'map' && (
          <>Click to select · scroll to zoom · drag a spec node onto a group to assign</>
        )}
        {section === 'graph' && graphMode === 'dep' && (
          <>Drag between two stories' side handles to link them — the arrow shows work flowing
            left→right · click an arrow to remove</>
        )}
        {section === 'reporting' && reportMode === 'timeline' && (
          <>Plan schedule as a Gantt · click a bar to open its group · ▸ projected finish · 🎯
            target date · dates &amp; capacity in ⚙ Settings</>
        )}
        {section === 'reporting' && reportMode === 'metrics' && (
          <>Projection, burn-up &amp; estimate-vs-actual · click a unit to open its group · set a
            target date in ⚙ Settings for variance</>
        )}
        {section === 'reporting' && reportMode === 'assignees' && (
          <>Per-assignee estimate-vs-actual, throughput &amp; weekly completions · assign a team in ⚙
            Settings · reflects completed stories only</>
        )}
        {section === 'reporting' && reportMode === 'concerns' && (
          <>Monitoring signals for the plan · overdue, blocked, cycles, gaps &amp; behind-target ·
            click a concern to open its group</>
        )}
      </footer>
    </div>
  );
}

/** Secondary pill nav for the active section's sub-views (e.g. Planning →
 *  Outline / Table / Markdown). Generic over the sub-mode union so each
 *  section's `set…` setter types through unchanged. */
function SubTabs<T extends string>({
  label,
  options,
  active,
  onSelect,
}: {
  label: string;
  options: [T, string][];
  active: T;
  onSelect: (value: T) => void;
}) {
  return (
    <nav className="view-tabs view-subtabs" aria-label={label}>
      {options.map(([value, text]) => (
        <button
          key={value}
          className={active === value ? 'view-tab view-tab-active' : 'view-tab'}
          onClick={() => onSelect(value)}
        >
          {text}
        </button>
      ))}
    </nav>
  );
}
