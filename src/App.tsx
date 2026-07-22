import { useEffect, useMemo, useRef, useState } from 'react';
import { GraphError } from './model/graph.ts';
import {
  deserializeProjectWithReport,
  serializeProject,
  type GraphRepair,
} from './model/serialize.ts';
import { clearUnrecoveredText, loadUnrecoveredText } from './persist/persistence.ts';
import { takePendingLoadRepairs } from './persist/loadReport.ts';
import { store, useProjectGraph } from './store/appStore.ts';
import { GraphView, type GraphMode } from './ui/GraphView.tsx';
import { HeaderMenu } from './ui/HeaderMenu.tsx';
import { MarkdownView } from './ui/MarkdownView.tsx';
import { Outliner } from './ui/Outliner.tsx';
import { projectToCsv } from './ui/planCsv.ts';
import { PlanningView } from './ui/PlanningView.tsx';
import { ProjectSwitcher } from './ui/ProjectSwitcher.tsx';
import { MetricsView } from './ui/MetricsView.tsx';
import { AssigneeMetricsView } from './ui/AssigneeMetricsView.tsx';
import { ConcernsView } from './ui/ConcernsView.tsx';
import { CoverageView } from './ui/CoverageView.tsx';
import { BaselineSelector } from './ui/BaselineSelector.tsx';
import { ScenarioPanel } from './ui/ScenarioPanel.tsx';
import type { ScenarioPatch } from './ui/scenario.ts';
import { SettingsView } from './ui/SettingsView.tsx';
import { ShortcutCheatsheet } from './ui/ShortcutCheatsheet.tsx';
import { shortcutsFor } from './ui/shortcuts.ts';
import { TimelineView } from './ui/TimelineView.tsx';
import { FilterFacets, type FacetValue } from './ui/FilterFacets.tsx';
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
  // Facets (#129) — same ephemeral rules as filterText, just disclosed
  // behind a picker instead of always-on so the header doesn't grow.
  const [facets, setFacets] = useState<FacetValue>({ statuses: [], priorities: [], tags: [] });
  // Whether the search/filter control is disclosed (#149 header compactness)
  // — collapses to an icon when unused; forced open below whenever a filter
  // is actually active, so an active filter is never hidden silently.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  // Per-side depth caps (undefined = all levels); ephemeral view state,
  // like planMode — never serialized.
  const [specMaxDepth, setSpecMaxDepth] = useState<number | undefined>(undefined);
  const [planMaxDepth, setPlanMaxDepth] = useState<number | undefined>(undefined);
  // What-if scenario (team/speed override) for Reporting's Timeline/Metrics
  // only — ephemeral, like the view state above; never touches the graph.
  const [scenario, setScenario] = useState<ScenarioPatch | null>(null);
  // Selected baseline (#131) for the same two views — which captured
  // snapshot to diff against; view state only, the baselines themselves
  // are persisted graph settings (see SettingsView).
  const [selectedBaselineId, setSelectedBaselineId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // A prior autosave that failed to load (main.tsx backs it up rather than
  // discarding it) shows a recovery banner until downloaded or dismissed.
  const [backupText, setBackupText] = useState<string | null>(null);
  // Structural repairs validateGraph made to load a corrupt file/autosave
  // (see serialize.ts) — shown once, then dismissed.
  const [loadRepairs, setLoadRepairs] = useState<GraphRepair[] | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useEffect(() => {
    void loadUnrecoveredText().then((text) => setBackupText(text ?? null));
    setLoadRepairs(takePendingLoadRepairs());
  }, []);

  // Collapse the disclosed search control on an outside click — same
  // pattern as HeaderMenu/FilterFacets's own outside-click handling, rather
  // than the input's onBlur (which fired the moment focus moved to the
  // Facets trigger inside this same widget, closing the picker before a
  // facet could be picked — a regression from #149).
  useEffect(() => {
    if (!searchOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [searchOpen]);

  // Views the filter applies to; others (Markdown, Reporting) are unchanged.
  const searchable =
    section === 'spec' ||
    (section === 'planning' && planMode !== 'markdown') ||
    section === 'graph';
  // Status only means anything on the plan side (CLAUDE.md: it's a
  // group-only field, never surfaced on the spec side) — Planning and
  // Graph both show group nodes, Spec never does. Scoped out of the
  // predicate itself (not just the picker) so a status facet left checked
  // while switching to Spec goes inert rather than silently hiding
  // everything (spec nodes never carry a real status).
  const showStatusFacet = section === 'planning' || section === 'graph';
  const filter: FilterState = useMemo(
    () => ({
      text: filterText,
      statuses: showStatusFacet ? facets.statuses : undefined,
      priorities: facets.priorities,
      tags: facets.tags,
    }),
    [filterText, facets, showStatusFacet],
  );
  const filterActive = isFilterActive(filter);
  const tagOptions = useMemo(
    () => Array.from(new Set(Object.values(graph.nodes).flatMap((n) => n.tags))).sort(),
    [graph],
  );
  const matchCount = useMemo(() => {
    if (!filterActive || !searchable) return 0;
    return Object.values(graph.nodes).filter((n) => {
      // Status is group-only (see showStatusFacet above) — a work node's
      // status is never surfaced/edited, so exclude it from a work node's
      // match check the same way PlanningView's spec pane and GraphView's
      // map do (#129), rather than let it silently zero out every work
      // node's count when a status facet is active.
      const effective = n.type === 'group' ? filter : { ...filter, statuses: undefined };
      if (!matchesFilter(n, effective)) return false;
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
      const { graph: imported, repairs } = deserializeProjectWithReport(await file.text());
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
      setLoadRepairs(repairs.length > 0 ? repairs : null);
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

  // Same healing for the selected baseline (deleted, or undone away).
  useEffect(() => {
    if (selectedBaselineId !== null && !graph.settings.baselines.some((b) => b.id === selectedBaselineId)) {
      setSelectedBaselineId(null);
    }
  }, [graph, selectedBaselineId]);
  const selectedBaseline = graph.settings.baselines.find((b) => b.id === selectedBaselineId) ?? null;

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
        <div className="app-header-main">
          <h1>Planning Tool</h1>
          <ProjectSwitcher />
          <nav className="view-tabs view-tabs-primary" aria-label="Section">
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
          <div className="section-nav-menu">
            <HeaderMenu label={`${SECTION_LABELS[section]} ▾`} title="Section" align="start">
              {(Object.keys(SECTION_LABELS) as Section[]).map((s) => (
                <button
                  key={s}
                  className={s === section ? 'project-menu-item project-menu-item-active' : 'project-menu-item'}
                  onClick={() => setSection(s)}
                >
                  {s === section ? '● ' : ''}
                  {SECTION_LABELS[s]}
                </button>
              ))}
            </HeaderMenu>
          </div>
          <span className="app-count">
            {itemCount} item{itemCount === 1 ? '' : 's'}
          </span>
        </div>
        <div className="app-header-actions">
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
          <button
            className="header-btn-icon"
            disabled={!store.canUndo}
            onClick={() => store.undo()}
            title="Undo (⌘Z)"
            aria-label="Undo"
          >
            ↩
          </button>
          <button
            className="header-btn-icon"
            disabled={!store.canRedo}
            onClick={() => store.redo()}
            title="Redo (⇧⌘Z)"
            aria-label="Redo"
          >
            ↪
          </button>
          <span className="header-divider" />
          <HeaderMenu label="☰" title="Menu">
            <button onClick={() => fileInputRef.current?.click()} title="Open a project .json">
              Open…
            </button>
            <button onClick={exportProject} title="Download the project as .json">
              Save…
            </button>
            <button onClick={exportCsv} title="Download the plan as .csv">
              Export CSV…
            </button>
            <div className="header-menu-divider" />
            <button onClick={() => setShortcutsOpen(true)} title="Keyboard shortcuts (?)">
              ⌨ Shortcuts
            </button>
            <div className="header-menu-divider" />
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
        </div>
      </header>
      {(section === 'spec' || section === 'planning' || section === 'graph' || section === 'reporting') && (
        <div className="app-subheader">
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
                ['coverage', 'Coverage'],
              ]}
              active={reportMode}
              onSelect={setReportMode}
            />
          )}
          {searchable && (
            <div
              className={`app-search${section === 'spec' ? '' : ' app-search-aside'}`}
              ref={searchRef}
            >
              {searchOpen || filterActive ? (
                <>
                  <input
                    type="search"
                    className="app-search-input"
                    placeholder="Filter…"
                    autoFocus={searchOpen}
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
                  <FilterFacets
                    value={facets}
                    onChange={setFacets}
                    showStatus={showStatusFacet}
                    tagOptions={tagOptions}
                  />
                </>
              ) : (
                <button
                  type="button"
                  className="header-btn-icon"
                  title="Filter…"
                  aria-label="Filter"
                  onClick={() => setSearchOpen(true)}
                >
                  🔍
                </button>
              )}
            </div>
          )}
          {section === 'reporting' && (reportMode === 'timeline' || reportMode === 'metrics') && (
            <div className="scenario-group">
              <span className="scenario-group-label">Scenario</span>
              <ScenarioPanel value={scenario} onChange={setScenario} baseSettings={graph.settings} />
              <BaselineSelector
                baselines={graph.settings.baselines}
                value={selectedBaselineId}
                onChange={setSelectedBaselineId}
              />
            </div>
          )}
        </div>
      )}
      {backupText && (
        <div className="app-banner" role="alert">
          A previous autosave couldn’t be loaded — nothing was deleted, it was kept as a backup
          instead.
          <button onClick={downloadBackup}>Recover backup…</button>
          <button onClick={discardBackup}>Discard</button>
        </div>
      )}
      {loadRepairs && (
        <div className="app-banner" role="alert">
          This file was repaired on load: {loadRepairs.length}{' '}
          {loadRepairs.length === 1 ? 'edge was' : 'edges were'} dropped to fix an invalid
          structure (a cycle, a double parent, or a double assignment).
          <button onClick={() => setLoadRepairs(null)}>Dismiss</button>
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
          <TimelineView
            selectedId={selectedId}
            onSelect={setSelectedId}
            onReveal={reveal}
            scenario={scenario}
            baseline={selectedBaseline}
          />
        )}
        {section === 'reporting' && reportMode === 'metrics' && (
          <MetricsView onReveal={reveal} scenario={scenario} baseline={selectedBaseline} />
        )}
        {section === 'reporting' && reportMode === 'assignees' && <AssigneeMetricsView />}
        {section === 'reporting' && reportMode === 'concerns' && <ConcernsView onReveal={reveal} />}
        {section === 'reporting' && reportMode === 'coverage' && <CoverageView onReveal={reveal} />}
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
        {section === 'reporting' && reportMode === 'coverage' && (
          <>Spec subtrees no group addresses, directly or via an ancestor · click an item to open
            it in the spec outliner</>
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
