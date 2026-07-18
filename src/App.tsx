import { useEffect, useMemo, useRef, useState } from 'react';
import { GraphError } from './model/graph.ts';
import { deserializeProject, serializeProject } from './model/serialize.ts';
import { clearUnrecoveredText, loadUnrecoveredText } from './persist/persistence.ts';
import { store, useProjectGraph } from './store/appStore.ts';
import { GraphView, type GraphMode } from './ui/GraphView.tsx';
import { HeaderMenu } from './ui/HeaderMenu.tsx';
import { MarkdownView } from './ui/MarkdownView.tsx';
import { Outliner } from './ui/Outliner.tsx';
import { projectToCsv } from './ui/planCsv.ts';
import { PlanningView } from './ui/PlanningView.tsx';
import { MetricsView } from './ui/MetricsView.tsx';
import { AssigneeMetricsView } from './ui/AssigneeMetricsView.tsx';
import { ConcernsView } from './ui/ConcernsView.tsx';
import { SettingsView } from './ui/SettingsView.tsx';
import { ShortcutCheatsheet } from './ui/ShortcutCheatsheet.tsx';
import { shortcutsFor } from './ui/shortcuts.ts';
import { TimelineView } from './ui/TimelineView.tsx';
import { isFilterActive, matchesFilter, type FilterState } from './ui/filter.ts';
import { hashFor, parseHash, type PlanMode, type ReportMode, type Section } from './ui/route.ts';

const SECTION_LABELS: Record<Section, string> = {
  spec: 'Spec',
  planning: 'Planning',
  graph: 'Graph',
  reporting: 'Reporting',
  settings: 'Settings',
};

/** Project repository — the ⧉ header link back to GitHub (issue #56). */
const GITHUB_URL = 'https://github.com/sam-omalley/spec-decomp-planning';

export function App() {
  const graph = useProjectGraph();
  // Navigation state is mirrored to the location hash (see the sync effect
  // below) so back/forward/refresh work; seed it from the hash on load.
  const initialRoute = parseHash(window.location.hash);
  const [section, setSection] = useState<Section>(initialRoute?.section ?? 'spec');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Sub-view within each section; lifted so the sub-tab bar and footer hint
  // can follow it. Markdown is a Planning sub-view now.
  const [planMode, setPlanMode] = useState<PlanMode>(initialRoute?.planMode ?? 'outline');
  const [graphMode, setGraphMode] = useState<GraphMode>(initialRoute?.graphMode ?? 'map');
  const [reportMode, setReportMode] = useState<ReportMode>(initialRoute?.reportMode ?? 'timeline');
  // Global filter/search — view state only; never enters the graph, undo,
  // or autosave. Shared across the Spec / Planning / Graph tabs.
  const [filterText, setFilterText] = useState('');
  // Per-side depth caps (undefined = all levels); ephemeral view state,
  // like planMode — never serialized.
  const [specMaxDepth, setSpecMaxDepth] = useState<number | undefined>(undefined);
  const [planMaxDepth, setPlanMaxDepth] = useState<number | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // A prior autosave that failed to load (main.tsx backs it up rather than
  // discarding it) shows a recovery banner until downloaded or dismissed.
  const [backupText, setBackupText] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useEffect(() => {
    void loadUnrecoveredText().then((text) => setBackupText(text ?? null));
  }, []);

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

  function downloadFile(text: string, filename: string, mime: string) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportProject() {
    downloadFile(
      serializeProject(store.getState()),
      `planning-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json',
    );
  }

  function exportCsv() {
    downloadFile(
      projectToCsv(store.getState()),
      `planning-${new Date().toISOString().slice(0, 10)}.csv`,
      'text/csv',
    );
  }

  function downloadBackup() {
    if (!backupText) return;
    downloadFile(
      backupText,
      `planning-backup-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json',
    );
  }

  function discardBackup() {
    void clearUnrecoveredText();
    setBackupText(null);
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

  // Mirror the navigation state into the location hash. The first run
  // normalises the URL without adding history (replaceState); later changes
  // (tab clicks, reveal) push an entry so Back returns to the prior view.
  // A back/forward navigation updates the hash *before* firing popstate, so
  // by the time state catches up the hash already matches — no extra push.
  const firstSync = useRef(true);
  useEffect(() => {
    const hash = hashFor({ section, planMode, graphMode, reportMode });
    if (window.location.hash !== hash) {
      if (firstSync.current) window.history.replaceState(null, '', hash);
      else window.history.pushState(null, '', hash);
    }
    firstSync.current = false;
  }, [section, planMode, graphMode, reportMode]);

  // Back/forward: re-derive the view from the hash. Only the active section's
  // sub-view is encoded, so the others keep their last value.
  useEffect(() => {
    function onPopState() {
      const route = parseHash(window.location.hash);
      if (!route) return;
      setSection(route.section);
      if (route.planMode) setPlanMode(route.planMode);
      if (route.graphMode) setGraphMode(route.graphMode);
      if (route.reportMode) setReportMode(route.reportMode);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey) {
        const key = event.key.toLowerCase();
        if (key === 'z') {
          event.preventDefault();
          if (event.shiftKey) store.redo();
          else store.undo();
        } else if (key === 'y') {
          event.preventDefault();
          store.redo();
        }
        return;
      }
      if (event.key !== '?' || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const editable =
          target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
        if (editable) return;
      }
      event.preventDefault();
      setShortcutsOpen(true);
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
        <HeaderMenu label="File">
          <button onClick={() => fileInputRef.current?.click()} title="Open a project .json">
            Open…
          </button>
          <button onClick={exportProject} title="Download the project as .json">
            Save…
          </button>
          <button onClick={exportCsv} title="Download the plan as .csv">
            Export CSV…
          </button>
          <a
            className="header-link"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            title="Open the project on GitHub (raise an issue, browse the code)"
          >
            GitHub ↗
          </a>
        </HeaderMenu>
        <button onClick={() => setShortcutsOpen(true)} title="Keyboard shortcuts (?)">
          ⌨ Shortcuts
        </button>
        <span className="header-divider" />
        <button disabled={!store.canUndo} onClick={() => store.undo()} title="⌘Z">
          ↩ Undo
        </button>
        <button disabled={!store.canRedo} onClick={() => store.redo()} title="⇧⌘Z">
          ↪ Redo
        </button>
      </header>
      {backupText && (
        <div className="app-banner" role="alert">
          A previous autosave couldn’t be loaded — nothing was deleted, it was kept as a backup
          instead.
          <button onClick={downloadBackup}>Recover backup…</button>
          <button onClick={discardBackup}>Discard</button>
        </div>
      )}
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
        {section === 'settings' && <SettingsView />}
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
          <>Click to select · scroll to zoom · drag a spec item's right handle onto a group's left to
            assign · grab an assignment arrow to move or remove it · Lock Spec/Plan re-flows the
            other side to align with assignments</>
        )}
        {section === 'graph' && graphMode === 'dep' && (
          <>Drag between two stories' side handles to link them — the arrow shows work flowing
            left→right · click an arrow to remove</>
        )}
        {section === 'reporting' && reportMode === 'timeline' && (
          <>Plan schedule as a Gantt · click a bar to open its group · ▸ projected finish · 🎯
            target date · dates &amp; capacity in the Settings tab</>
        )}
        {section === 'reporting' && reportMode === 'metrics' && (
          <>Projection, burn-up &amp; estimate-vs-actual · click a unit to open its group · set a
            target date in the Settings tab for variance</>
        )}
        {section === 'reporting' && reportMode === 'assignees' && (
          <>Per-assignee estimate-vs-actual, throughput &amp; weekly completions · assign a team in
            the Settings tab · reflects completed stories only</>
        )}
        {section === 'reporting' && reportMode === 'concerns' && (
          <>Monitoring signals for the plan · overdue, blocked, cycles, gaps &amp; behind-target ·
            click a concern to open its group</>
        )}
        {section === 'settings' && (
          <>Project &amp; scheduling settings · dates, team, capacity, conversion &amp; locks · every
            change is undoable and autosaved</>
        )}
      </footer>
      <ShortcutCheatsheet
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        groups={shortcutsFor(section, planMode, graphMode)}
      />
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
