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

Single `ProjectGraph` = `nodes` + `edges` + two root-order arrays
(see `src/model/types.ts`). Nodes have two sides:

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
  `actualFinish`, and `externalRefs` (Jira etc.). `effort` (size) and
  `durationEstimate` (time) are distinct axes, convertible via
  `settings.pointsPerDay`. Groups are the nodes that get scheduled,
  tracked, and sequenced by dependencies.
- **Edges**: typed — `contains`, `depends_on`, `implements`,
  `assigned_to`, `blocks`, `duplicates`, `related_to`. `contains` edges
  carry `order` for sibling ordering; root order lives in
  `ProjectGraph.rootOrder` (work side) and `groupRootOrder` (group
  side), maintained by every mutation, reconciled on file load.
  File version 4; v1/v2 migrate (plans → root groups, epics → child
  groups, `belongs_to_epic` → `assigned_to`, first membership wins),
  v3 → v4 backfills the estimate/actual/`externalRefs` node fields and
  `settings` with defaults. On load, `depends_on`/`blocks` edges that
  touch a work node are dropped — dependencies are group-only now, so
  any legacy spec-level deps are discarded (the only lossy migration).
- **Project settings** (`ProjectGraph.settings: ProjectSettings`) — the
  scheduling config: `startDate`, `targetDate`, `pointsPerDay`,
  `hoursPerDay`, `parallelTracks`, `speedMultiplier`. Carried inside the
  graph so it rides the store/undo/serialize/autosave path unchanged.

The project-management extension (slices 9–13 below) schedules and
tracks the **plan** (group tree). Rollup runs along group `contains`
(own estimate wins over child sum); nothing rolls up from assigned spec
items. Its scheduler/views are still to build.

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

- Views are pure projections of the graph: spec view reads the work
  side of `contains`, planning view reads the group side plus
  `assigned_to`, graph view reads everything. Never store view-specific
  copies of data.
- **Dependency-free core.** No zustand, no immer (also: sandbox npm was
  blocked when built). Mutations are immutable with structural sharing;
  undo/redo is a snapshot stack in `src/store/projectStore.ts`. One
  `store.commit(fn)` = one atomic undo step; throwing mutations leave state
  and history untouched. React binds via `useSyncExternalStore`.
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
- Primary editing surface is the **outliner** (Enter = sibling, Tab =
  indent). One generic `Outliner` component drives both sides via a
  `side` prop (`outline.ts` helpers are side-aware); the planning view
  augments group rows with member chips + drop targets via `rowExtras`
  / `rowDropProps`. Graph view is for understanding/navigation,
  read-mostly in v1. Selection is lifted to `App`, syncs between views,
  healed there when the node disappears.
- Assignment UX: drag spec row onto a group row (native HTML5 DnD);
  drop moves (single membership), drag a chip to the spec pane or × to
  unassign. Spec pane shows coverage tags (solid = direct, dashed =
  inherited via ancestor), colored per root group.
- Details, Things3-style: every node (both sides) has Title + optional
  Details (the `description` field). Titles only until expanded — ⌘↩
  or the ≡ indicator opens an inline card (one per outliner, closes on
  selection move / Esc / ⌘↩). Details edits coalesce per editor visit;
  opening/closing the card breaks coalescing explicitly because the
  textarea's blur handler does not fire on unmount.

## Slice plan

1. ✅ Data model + store + undo/redo + tests
2. ✅ Outliner spec view (`src/ui/`; pure row/keyboard-target helpers in
   `outline.ts` are unit-tested; store commits gained an optional
   `coalesce` key so typing a title is one undo step)
3. ✅ Planning view — originally plans/epics, reworked 2026-07 into the
   symmetric group forest (`PlanningView.tsx`, coverage/overlap helpers
   in `planning.ts`, unit-tested)
4. ✅ IndexedDB autosave + `.json` save/load (pulled forward 2026-07 —
5. ✅ Graph view (`GraphView.tsx` + pure tidy layout in `graphLayout.ts`,
   unit-tested: spec forest left-to-right, delivery forest mirrored
   right-to-left, dashed `assigned_to` edges bridge the gap, colored
   per root group via shared `colors.ts`. Read-mostly: pan/zoom/click
   to select; no dragging — positions re-derive from the graph)
6. ✅ Dependencies (`src/model/analysis.ts`, pure + unit-tested: the
   relation combines `depends_on` with inverse `blocks`; Tarjan SCC
   for cycles; `waitingMap` = unfinished direct prerequisites; the
   analysis is node-type-agnostic). **Reworked 2026-07 (see slice 9a):
   deps and status/tracking now live on the PLAN (group) side, not the
   spec.** Deps connect group nodes only, enforced in `addEdge`. UX:
   "Depends on" editor + status control in the group details card;
   ⧗/⟳ badges on waiting/cycling group rows; graph view draws dep edges
   dependent → prerequisite with arrowheads, cycles red + animated. The
   spec side became purely structural.
7. ✅ Markdown view (`MarkdownView.tsx` + pure `planMarkdown.ts`,
   unit-tested: the delivery plan as Markdown — groups are depth
   headings (clamped h6), assigned work items a bullet list with
   spec sub-items nested, titles verbatim, optional Backlog of
   uncovered work. Builds one block model → both a copyable source
   string and the rendered preview so they can't drift. Per-section
   toggles (details / sub-items / backlog); read-only, Copy to export.
   Members ordered by spec pre-order.)

Project-management extension (planned, in dependency order — 8 unblocks
all; 9 and 10 are independent; 11–13 consume 10). Each slice is
shippable alone and keeps the dependency-free-core / tested-domain rules:

8. ✅ Model foundation — `types.ts` (the fields in Data model above),
   `serialize.ts` v4 + backfill migration (tested), and new `graph.ts`
   mutations: `setEstimate` (non-negative, per-axis), `setActualDates`,
   `addExternalRef` / `removeExternalRef` (dedup on system+key),
   `updateSettings` (validates capacity/conversion). All invariant-tested
   in `graph.test.ts`. **Status auto-derives from actuals:** `actualFinish`
   set ⇒ `done`; `actualStart` set with no finish ⇒ `in_progress` unless
   manually `blocked` (a started-then-blocked item stays blocked); neither
   set ⇒ status untouched, so manual states survive.
9. ✅ Entry UI — `NodeMetaEditor.tsx` (details-card fields: status,
   priority, the two estimate axes points + duration/days, actual
   start/finish dates, external-ref chips) + a compact rolled `Nd · Npt`
   estimate chip on rows (⚠ when a subtree has unestimated leaves) +
   pure `src/model/rollup.ts` (unit-tested): `rolledDuration` /
   `rolledEffort` / `rolledActuals`. **Rollup rule (also the
   scheduling-unit rule):** the topmost node with an own estimate is the
   atomic unit and its subtree isn't descended into — own wins over child
   sum, no double counting; unestimated leaves are gaps. (`rollup.ts` in
   `model/` so the slice-10 scheduler imports it without a ui→model
   back-dependency.) NOTE: first built on the spec/work side by mistake;
   corrected by slice 9a.
9a. ✅ Re-targeted to the plan. Estimation, actuals, keys, status and
   dependencies live on the **group (plan)** side; the spec is purely
   structural (title + details only). `Outliner` renders status bullets,
   dep badges, estimate chip and the `NodeMetaEditor`/`DependencyEditor`
   details editors on `side === 'group'`; `DependencyEditor` candidates
   are groups; `addEdge` requires both dep endpoints be groups;
   `serialize` drops `depends_on`/`blocks` edges touching a work node on
   load. Shipped dep tests (`graph`/`analysis`/`projectStore`) flipped to
   groups. Verified in preview: plan rows carry the editor + status; spec
   view is structural-only.
10. Scheduler — `src/model/schedule.ts`, pure + heavily tested. Schedules
    the **group tree** (the plan). Forward resource-constrained schedule:
    scheduling units = topmost groups with an own estimate (`rollup.ts`);
    dependency order between groups (reusing `analysis.ts`) → each unit to
    the earliest-free of `parallelTracks` → duration =
    `durationEstimate / speedMultiplier`, snapped to a skip-weekends
    working-day calendar from `settings.startDate`. Blends actuals over
    projection (done = actual dates; in-progress = `actualStart` +
    remaining). Dependency cycles tolerated: an SCC schedules as one batch
    by sibling order (never hangs). Output: per-group
    `{start, finish, source: 'planned' | 'actual'}` + project finish.
    (`assigned_to` is traceability only, not an input to scheduling.)
    Tests: dep order, parallelism cap, weekend skipping, cycle batch,
    actual override.
11. Settings UI — panel for `startDate`, `targetDate`, `pointsPerDay`,
    `hoursPerDay`, `parallelTracks`, `speedMultiplier`; edits go through
    `updateSettings` (undoable, autosaved with the graph).
12. Timeline / Gantt view — new 5th tab `TimelineView.tsx` + pure
    `timelineLayout.ts` (unit-tested). Bars per scheduling unit grouped
    by delivery group, planned-vs-actual overlay, projected-finish and
    target-date markers. Hand-rolled SVG like `GraphView` (no chart
    dep); register in the `App.tsx` `View` union and tab bar.
13. Metrics view — new 6th tab `MetricsView.tsx` + pure `metrics.ts`
    (unit-tested): projection summary (completion date, remaining,
    variance vs target), burn-up / burn-down (cumulative done vs total
    over time), estimate-vs-actual variance (per-item + rolled). Also
    hand-rolled SVG, no new deps.

- v2+: merge/split nodes, bulk edit, critical path, richer graph editing.

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
- Sandbox notes: npm registry access requires it to be enabled AND a fresh
  session; folder file deletion needs the allow-delete permission (git lock
  files trip this).
