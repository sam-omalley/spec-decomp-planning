# Planning Tool

A web app that turns a high-level specification into an implementation plan
through iterative decomposition and regrouping. Not a mind map: a graph-based
planning tool with multiple synchronized views. Full product spec lives in the
original conversation; the essentials are encoded here.

## Core principle

Decomposition (nested inputs) and delivery planning (nested outputs) are
**independent projections of one underlying graph**, symmetric by design.
Changing the spec hierarchy must never destroy planning information;
changing assignments must never change the decomposition. Deliberately
NOT overspecialised: there is no "plan"/"epic"/"block" entity — just
groups nesting in groups.

**Which side owns what (important — the two sides are not interchangeable
for project management).** The **spec** (work nodes, left) is *purely
structural*: a decomposition of what must be built. It carries no
estimates, no progress, no dependencies. The **plan** (groups, right —
by convention Block → Epic → Story, but that is naming only, not baked
in) is the thing you *estimate, track and sequence*: estimation, actual
start/finish, external keys (Jira), status, and dependencies all live on
**group nodes**. `assigned_to` is **traceability only** — "this delivery
group addresses these spec items" — and feeds nothing into estimation or
scheduling. Spec items are not stories; the plan's stories are leaf
groups.

## Data model

Single `ProjectGraph` = `nodes` + `edges` + two root-order arrays + project
`settings` (see `src/model/types.ts`). Nodes have two sides:

- **Work nodes** — requirement, feature, capability, component,
  user_story, task, research, bug. The spec tree. Structural data only
  (title, description, tags, priority); all relationships are edges.
  The planning fields below exist on every node (shared type) but are
  **only meaningful on group nodes** — the spec never surfaces or uses
  them.
- **Group nodes** (`type: 'group'`) — the delivery tree / plan: blocks
  of epics, epics of sub-epics, any depth. Bare groups; depth conveys
  meaning, no kind labels. Groups carry the planning fields: `status`,
  effort points, `durationEstimate` (working days), `actualStart` /
  `actualFinish` (ISO date, or ISO datetime-local when a time is set — a
  bare date reads as 00:00; the scheduler stays day-granular and drops any
  time, elapsed-duration metrics use it), `resourceId` (pins the group to a
  team member — see Project settings), and `externalRefs` (Jira etc.).
  `effort` (size) and `durationEstimate` (time) are distinct axes,
  convertible via `settings.pointsPerDay`. Groups are the nodes that get
  scheduled, tracked, and sequenced by dependencies. **Rollup /
  scheduling-unit rule:** the topmost node in a subtree with its own
  estimate is the atomic unit for both rollup display and scheduling — own
  value wins over summing children (no double counting), and an
  unestimated leaf is a gap. One implementation (`src/model/rollup.ts`)
  backs both the row estimate chip and the scheduler's unit selection, so
  the two can't disagree.
- **Edges**: typed — `contains`, `depends_on`, `implements`,
  `assigned_to`, `blocks`, `duplicates`, `related_to`. `contains` edges
  carry `order` for sibling ordering; root order lives in
  `ProjectGraph.rootOrder` (work side) and `groupRootOrder` (group
  side), maintained by every mutation, reconciled on file load.
  File version 6 (`src/model/serialize.ts` has the full per-version
  migration history in comments); every version migrates forward with no
  data loss except one case: on load, `depends_on`/`blocks` edges that
  touch a work node are dropped, since dependencies are group-only now
  and any legacy spec-level deps are meaningless.
- **Project settings** (`ProjectGraph.settings: ProjectSettings`) —
  project-level config, carried inside the graph so it rides the
  store/undo/serialize/autosave path unchanged. Scheduling: `startDate`,
  `targetDate`, `pointsPerDay`, `hoursPerWeek`, `speedMultiplier`, and
  `resources` — the delivery **team** (`{ id, name, fte }`). Capacity is
  one scheduling track per resource (an empty team is a single implicit
  full-time track); a group's `resourceId` pins its scheduling unit to
  that resource's track, and FTE stretches duration
  (`durationEstimate / (speedMultiplier × fte)` — a 0.8-FTE resource's
  work takes `1 / 0.8` longer). Editing locks: `specLockDepth` /
  `planLockDepth` — how many top levels of each side are frozen against
  accidental edits (0 = unlocked; see the Locks bullet below). Locks are a
  *config value*, not a graph invariant: they gate the editing UI, not the
  core mutations.

Rollup runs along group `contains` (own estimate wins over child sum);
nothing rolls up from assigned spec items.

### Invariants (enforced in `src/model/graph.ts`, tested)

- `contains` is a single-parent, acyclic forest on each side and never
  crosses sides — work nests in work, groups in groups.
- `assigned_to` is the only bridge: work node → group, at any depth.
  **Single membership** — `assignToGroup` moves an existing assignment
  atomically; raw `addEdge` rejects a second one. Non-leaf work nodes
  may be assigned (covers the subtree).
- No duplicate (type, from, to) edges; no self-edges.
- Dependencies (`depends_on` / `blocks`) connect **group nodes only** —
  they sequence the plan; work nodes are structural and cannot carry
  deps (enforced in `addEdge`). Dependency cycles are **allowed** — they
  get detected (Tarjan) and visualized, never forbidden. `contains`
  cycles are rejected.
- Deletes cascade: subtree + every touching edge. Deleting a group
  subtree removes assignments into it, never work nodes. UI must
  confirm before cascade deletes.
- Overlap vs refinement: a member's descendant assigned *within* the
  member's group subtree is refinement (fine, no badge); assigned
  outside it (sibling group, other block, coarser ancestor group) the
  member gets the overlap badge. Visible, never forbidden.

## Architecture decisions

- **Views are pure projections of the graph and its settings.** Spec view
  reads the work side of `contains`; Planning reads the group side plus
  `assigned_to`; Graph reads everything; the Reporting sub-views (Timeline,
  Metrics, Assignees, Concerns) derive from the scheduler / rollup /
  concerns analysis. None store view-specific copies of data. Ephemeral
  view-narrowing state — global search/filter, per-side depth caps, the
  Graph view's sort mode and infer-chains toggle, and the current
  section/sub-view (mirrored to the URL hash for navigation, see below) —
  never touches the graph, store, or undo history; it lives in React state
  and is applied as a pure projection in the view layer.
- **Dependency-free core.** No zustand, no immer (also: sandbox npm was
  blocked when built). Mutations in `src/model/graph.ts` are immutable
  with structural sharing; undo/redo is a snapshot stack in
  `src/store/projectStore.ts`, a framework-free class kept separate from
  its React binding (`src/store/appStore.ts`, `useSyncExternalStore`) so
  the store itself is testable under the Node runner without React. One
  `store.commit(fn)` = one atomic undo step; throwing mutations leave
  state and history untouched. Because the graph is immutable with a
  stable reference between mutations, `graph.ts`'s edge-scanning selectors
  (`parentEdgeOf`, `childrenOf`, `assignmentEdgeOf`, `membersOfGroup`,
  `edgeBetween`) are backed by a `WeakMap<ProjectGraph, GraphIndex>` cache
  keyed on that reference — a cache miss rebuilds the index once per new
  graph, turning what would be O(N·E) traversals (rollup, scheduling,
  outline flattening) into O(1)/O(children) lookups.
- Ids: `crypto.randomUUID()` generated by callers (`createId()`), passed
  into mutations — keeps mutations deterministic and testable.
- Persistence: versioned JSON envelope (`src/model/serialize.ts`) used
  for both `.json` files and IndexedDB autosave (`src/persist/` — DB
  `planning-tool`, store `project`, key `current`), so loading from
  either goes through the same validation/migration. Autosave is a
  debounced (300 ms) subscriber, deduped by state reference, flushed on
  visibilitychange; `main.tsx` loads before first render. Import
  confirms before replacing a non-empty project; `store.reset` clears
  undo history by design.
- Navigation is hash-routed (`src/ui/route.ts`, pure + tested): the active
  top-level section (Spec / Planning / Graph / Reporting / Settings) and
  its sub-view are mirrored into the location hash (`#/reporting/metrics`)
  so browser back/forward/refresh and the cross-view "reveal" jump behave
  like a real app. Hash-based rather than path-based so it works on static
  hosting (GitHub Pages) with no server rewrites. Read-only surfaces
  (`PlanTable`, Metrics, Timeline, Concerns) route back into the editable
  outliner via an app-level `reveal(id)`, which jumps to a group's
  Planning/Outline row or a work node's Spec row and selects it.
- Primary editing surface is the **outliner** (Enter = sibling, Tab =
  indent). One generic `Outliner` component drives both sides via a
  `side` prop (`outline.ts` helpers are side-aware); the planning view
  augments group rows with member chips + drop targets via `rowExtras`
  / `rowDropProps`. `PlanTable` is a plan-side-only alternate surface (an
  Outline/Table toggle inside Planning): one row per group in pre-order,
  every plan field an inline column reusing the same mutations, with
  container rollups shown as a muted placeholder. Bulk editing reuses the
  same mutations rather than adding new ones: pasting multi-line text
  creates rows with nesting inferred from indentation, and a lifted
  multi-select (⇧/⌘-click, ⇧↑↓) fans structural ops (indent/outdent/
  reorder/delete) out over a contiguous sibling run, or a field edit in
  `PlanTable` across the whole selection, as one undo step. Selection is
  lifted to `App`, syncs between views, healed there when the node
  disappears.
- **Assignment authoring has two surfaces**, both driving the same
  `assignToGroup` mutation (single membership, moves an existing
  assignment): the Planning view's Outline uses native HTML5
  drag-and-drop (drag a spec row onto a group row, drag a chip to the spec
  pane or × to unassign); the Graph tab's Map mode offers the same action
  via React-Flow handle-drag (a work node's right handle onto a group's
  left handle). The spec pane shows coverage tags (solid = direct, dashed
  = inherited via ancestor), colored per root group.
- **Handle-drag authoring** (Graph tab's Map mode, and the Dependency
  mode's `depends_on` edges) is driven by *which side each card
  contributes*, not which end starts the drag — so a drag either
  direction authors the same edge, and `connectionMode="loose"` lets
  either end start or receive. The pure resolvers (`mapAuthoring.ts` /
  `depAuthoring.ts`, unit-tested) decide the edge's meaning and which
  handle each card should reveal mid-drag. A shared `AuthoringCanvas`
  (`src/ui/AuthoringCanvas.tsx`) factors out the React-Flow scaffolding
  common to both views — loose connection mode, a wide reconnect radius
  (close-together nodes need more than the 10px default to grab), a
  `FitOnReflow` that re-fits the viewport when the layout changes, and
  grab-near-an-end reconnection (drop on a valid handle to re-home an
  edge, on empty space to delete it; only a real, directly-authored edge
  is reconnectable — inferred and container-fan-out edges are not). Each
  view still owns its node renderer/handle topology, connection
  semantics, and layout source (`graphLayout.ts` vs `depLayout.ts`).
- The Dependency graph view **ghosts an inferred sequential chain**
  across sibling leaf groups with no explicit ordering between them
  (dashed/muted, distinct from real edges), suppressed per-pair the
  moment the *transitive* explicit dependency relation already orders
  that pair — not just a direct edge, so the inference never contradicts
  an order that only exists via a longer chain. Purely a display
  computation in `depLayout.ts`: never written to the graph, never fed to
  the scheduler, so it can't silently move dates.
- The scheduler (`src/model/schedule.ts`) does forward, resource-
  constrained placement of scheduling units on a skip-weekends calendar,
  blending in actuals: a done unit uses its real dates (frees no future
  capacity; dependents start the next working day); an in-progress unit
  uses its real start plus a projected remainder; everything else is
  fully projected. Dependency cycles are tolerated during scheduling too
  — when nothing is dependency-ready, the lowest sibling-order unit is
  placed anyway, so a cyclic SCC drains as a batch instead of hanging the
  scheduler.
- Structural locks (`specLockDepth` / `planLockDepth`) are **UI-level,
  not a graph invariant** — they gate the editing affordances in
  `Outliner`/`PlanTable` via a pure `isLocked` predicate
  (`src/ui/locks.ts`), so import/undo/programmatic paths pass through
  `graph.ts` unchanged. A lock freezes shape + naming only: children can
  still be added below the deepest locked level, assignment stays
  allowed, and a locked group's plan meta (status, estimate, dates, deps,
  refs) remains editable. The effective lock depth **clamps to the
  number of levels that currently exist** on that side, so configuring a
  lock deeper than the tree never hides the "add the first item"
  affordance.
- Details, Things3-style: every node (both sides) has Title + optional
  Details (the `description` field). Titles only until expanded — ⌘↩
  or the ≡ indicator opens an inline card (one per outliner, closes on
  selection move / Esc / ⌘↩). Details edits coalesce per editor visit;
  opening/closing the card breaks coalescing explicitly because the
  textarea's blur handler does not fire on unmount. External-tracker
  refs (Jira etc.) are entered through a shared `KeyEditor`: a single
  key-only input that defaults `system: 'jira'`, though the underlying
  `ExternalRef` model (system/key/url) stays general for imported data
  with a URL or a non-Jira system.
- The Markdown view builds **one block model** from the plan
  (`src/ui/planMarkdown.ts`) that feeds both the copyable source string
  and the rendered preview, so the two can't drift apart.
- Charts (Timeline bars, the Metrics burn-up) are hand-rolled SVG with no
  charting dependency, kept visually consistent with the rest of the app.
  Reporting views that derive schedule-backed models memoize with
  `useMemo` like the rest of the app; `MetricsView` in particular computes
  `scheduleProject` once and threads the result into both
  `projectionSummary` and `burnUp` rather than letting each call it
  separately.
- The Reporting section groups four read-only sub-views behind one tab:
  Timeline (Gantt), Metrics (projection/burn-up/estimate-vs-actual),
  Assignees (per-resource estimate-vs-actual, points/day, weekly
  completions), and Concerns (`src/model/concerns.ts`'s
  `analyzeConcerns`: per-unit overdue/blocked/cycle/unestimated/
  unassigned flags, plus project-level thin-WIP and behind-target
  signals, severity-sorted). Settings is a full-page tab (two-column card
  layout), not a header popover — it outgrew that.

## Conventions & environment

- Tests: Node built-in runner, no deps — `npm test`
  (`node --experimental-strip-types --test "src/**/*.test.ts"`).
  Test the domain layer thoroughly; every invariant gets a test.
- TypeScript: strict, `verbatimModuleSyntax` + `erasableSyntaxOnly`
  (Node strip-types: `import type` for types, no enums, no constructor
  parameter properties). Relative imports use explicit `.ts` extensions.
- `npm install` only needed for the Vite dev server (React 19, Vite 6,
  @xyflow/react); the core and tests run without it.
- Git: conventional-commit style messages (`feat:`, `chore:`…).
  Workflow: branch off `main` (`feat/…`, `chore/…`), commit, push, and
  open a PR with `gh` rather than committing to `main` directly. Merge
  with **squash** to keep `main`'s history linear (one commit per change),
  and delete the branch. Wait for any CI checks before merging.
- Sandbox notes: npm registry access requires it to be enabled AND a fresh
  session; folder file deletion needs the allow-delete permission (git lock
  files trip this).
