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
  File version 5; v1/v2 migrate (plans → root groups, epics → child
  groups, `belongs_to_epic` → `assigned_to`, first membership wins),
  v3 → v4 backfills the estimate/actual/`externalRefs` node fields and
  `settings` with defaults, v4 → v5 backfills the lock depths
  (`specLockDepth` / `planLockDepth`, both 0 = unlocked). On load,
  `depends_on`/`blocks` edges that
  touch a work node are dropped — dependencies are group-only now, so
  any legacy spec-level deps are discarded (the only lossy migration).
- **Project settings** (`ProjectGraph.settings: ProjectSettings`) —
  project-level config, carried inside the graph so it rides the
  store/undo/serialize/autosave path unchanged. Scheduling:
  `startDate`, `targetDate`, `pointsPerDay`, `hoursPerDay`,
  `parallelTracks`, `speedMultiplier`. Editing locks (slice 17):
  `specLockDepth` / `planLockDepth` — how many top levels of each side
  are frozen against accidental edits (0 = unlocked). Locks are a *config
  value*, not a graph invariant: they gate the editing UI, not the core
  mutations. In contrast, ephemeral view narrowing — search/filter (slice
  15) and depth caps (slice 16) — is *not* stored here; it lives in React
  view state and never touches the graph, store, or undo history.

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
9. a) ✅ Entry UI — `NodeMetaEditor.tsx` (details-card fields: status,
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
   b) ✅ Re-targeted to the plan. Estimation, actuals, keys, status and
   dependencies live on the **group (plan)** side; the spec is purely
   structural (title + details only). `Outliner` renders status bullets,
   dep badges, estimate chip and the `NodeMetaEditor`/`DependencyEditor`
   details editors on `side === 'group'`; `DependencyEditor` candidates
   are groups; `addEdge` requires both dep endpoints be groups;
   `serialize` drops `depends_on`/`blocks` edges touching a work node on
   load. Shipped dep tests (`graph`/`analysis`/`projectStore`) flipped to
   groups. Verified in preview: plan rows carry the editor + status; spec
   view is structural-only.
10. ✅ Scheduler — `src/model/schedule.ts`, pure + heavily tested
    (`scheduleProject`, `schedulingUnits`). Schedules the **group tree**
    (the plan). Scheduling units = topmost groups with an own estimate;
    unit deps expand from the raw group dep graph (`analysis.ts`,
    container endpoints fan out to their descendant units). Forward
    resource-constrained placement: each unit to the earliest-free of
    `parallelTracks` tracks → duration = `durationEstimate /
    speedMultiplier` working days on a skip-weekends calendar from
    `settings.startDate` (internal continuous working-day offsets ⇄ ISO
    dates). Blends actuals: done = real dates (source `actual`, frees no
    future capacity, dependents start the next working day); in-progress =
    real `actualStart` + projected remainder; else fully projected. Cycles
    tolerated — when nothing is dependency-ready the lowest sibling-order
    unit goes anyway, so an SCC drains as a batch and the loop never
    hangs. Output: `groups` map (units by own dates, containers by span) +
    `projectStart` / `projectFinish`. (`assigned_to` unused.) Tests: unit
    selection, weekend skipping, dep order, parallelism cap, speed
    multiplier, cycle batch, container span, done/in-progress override.
11. ✅ Settings UI — header ⚙ popover (`SettingsPanel.tsx`) with
    Schedule / Capacity / Conversion sections: `startDate`, `targetDate`,
    `parallelTracks`, `speedMultiplier`, `pointsPerDay`, `hoursPerDay`.
    Edits go through `updateSettings` (undoable, autosaved with the
    graph), coalesced per field; inputs are pre-validated so an invalid
    value is ignored rather than thrown (a throwing commit would
    propagate). Closes on outside-click / Esc. Verified in preview.
12. ✅ Timeline / Gantt view — 5th tab `TimelineView.tsx` + pure
    `timelineLayout.ts` (unit-tested). Bars per scheduled group in
    pre-order (containers span their units), fraction-based geometry over
    the date range, ▸ projected-finish and 🎯 target-date markers, weekly
    gridline ticks, actual (done) bars styled distinctly from planned.
    Hand-rolled SVG, no chart dep. Verified in preview.
13. ✅ Metrics view — 6th tab `MetricsView.tsx` + pure `src/model/metrics.ts`
    (unit-tested): `projectionSummary` (projected finish, done/remaining
    days + points, calendar-day variance vs target, onTrack),
    `estimateVsActual` (per done-unit + rolled, working-day durations),
    `burnUp` (cumulative done vs constant total). Summary cards +
    hand-rolled SVG burn-up (ideal / total / target lines) + est-vs-actual
    bars. Verified in preview.

14. ✅ Bulk editing — three surfaces over the existing graph, **no model
    change** (all reuse existing mutations + pure helpers): (a) **paste
    multi-line text → rows**, nesting inferred from indentation
    (`parseOutlineText` in `ui/outline.ts`, tested; wired via
    `Outliner`/`OutlinerRow` `onPaste` as one undo step, works both
    sides; the first line fills an empty anchor row, else all insert
    after). (b) **Multi-select** (⇧/⌘-click, ⇧↑↓) layered on App's single
    selection anchor via `ui/useMultiSelect.ts`; structural ops fan out
    over a clean contiguous sibling run — indent/outdent/reorder/delete —
    gated by `contiguousSiblingRange` (`outline.ts`, tested), else fall
    back to the single anchor row. (c) **Plan field table** as an
    Outline/Table toggle inside Planning (`PlanTable.tsx`) — plan-side
    only (the spec stays structural), one row per group in pre-order,
    every plan field an inline column reusing
    `updateNode`/`setEstimate`/`setActualDates`; container rollup shows as
    a muted placeholder; editing a field with a multi-selection bulk-sets
    it across the selection in one commit. Verified in preview.

    View narrowing + locking + graph modes (planned, slices 15–18). All are
    **view/config layers over the existing graph — no new node/edge types.**
    15 and 16 are ephemeral view state (React-only, never serialized/undone);
    17 is a persisted config value on `settings`; 18 is a new projection.
    15 lays the toolbar + filtered-`visibleRows` path that 16 extends; 17 and
    18 are independent. Each keeps the pure-helpers-in-`model`/`ui`,
    tested-domain rule.

15. ✅ Global filter/search — a header search box (lifted App state, shared
    across tabs, cleared on Esc; **not** stored in the graph, undo, or
    autosave; rendered only on the searchable tabs). Pure `ui/filter.ts`
    (unit-tested): a `FilterState` (case-insensitive text over
    title/description/tags, plus optional conjunctive facets —
    priority, status, tags) with `isFilterActive` + `matchesFilter(node,
    state)`. Views apply it as a projection, never a mutation:
    **Outliner** is hierarchy-aware via a filtered variant of
    `visibleRows` (new `match` arg; rows gain a `matched` flag) — it keeps
    matches plus their ancestor path (ancestors dimmed `.row-context`,
    matches marked `.row-match`), drops the rest, and ignores per-node
    collapse so deep matches surface. **PlanningView** filters its spec
    pane the same way and passes the filter to the group Outliner and the
    Table sub-view (`PlanTable`, group rows narrowed the same way).
    **GraphView** dims non-matches in place (never hides — structure must
    stay legible), composing with its existing unassigned/empty spotlight.
    A live match count sits by the box. Scope: Spec, Planning, Graph —
    Timeline/Metrics/Markdown unchanged. Verified in preview.
16. ✅ Depth filtering (Spec + Planning) — a compact depth stepper
    (`1 2 3 … All`) in each outliner's toolbar capping visible rows to the
    top N levels (roots = depth 0; "N levels" ⇒ depth < N). A node at the
    cutoff with hidden descendants reuses the existing collapsed
    child-count "+k" affordance. Pure: extend `visibleRows` with an
    optional `maxDepth` (the recursion already tracks depth — a trivial
    cutoff), unit-tested. Per-side view state in App (like `planMode`),
    not serialized. Composes with 15: the cap and the filter are
    independent narrowings, but an active search wins — matched rows and
    their ancestors surface even past the depth cap, so search can always
    reach deep matches.
17. ✅ Structural lock (top-N levels) — freeze the top `specLockDepth` /
    `planLockDepth` levels of a side against *accidental* edits (a node is
    locked when its depth < the side's lock depth; roots = depth 0). New
    integer fields on `ProjectSettings` (default 0), set via a **Locks**
    section in the ⚙ Settings popover through `updateSettings` (validates
    non-negative ints; undoable, autosaved, serialized — serialize bumps
    to v5, backfilling 0). Enforcement is deliberately **UI-level, not a
    graph invariant**: it gates the editing affordances, so import/undo/
    programmatic paths still pass through `graph.ts` unchanged — a locked
    row prevents fat-finger edits, it is not a data guarantee. A pure
    `isLocked(depth, side, settings)` predicate (tested) drives guards in
    `Outliner`/`OutlinerRow` and `PlanTable`. Locked rows render faded
    (muted, reduced opacity) with a small 🔒, `readOnly` title/details,
    and disabled reorder/indent/outdent/delete. Crucially, lock freezes
    **shape + naming only**: you can still add *children* below the
    deepest locked level (new descendants are unlocked — "brainstorm in
    the leaves"), assignment (`assigned_to`) onto/off a locked group stays
    allowed (traceability, not structure), and the plan meta fields
    (status, estimate, dates, deps, refs) remain editable on a locked
    group — you estimate and track against a fixed skeleton.
18. ✅ Graph tab view modes + Dependency View — the Graph tab gets an
    internal mode switch (segmented control): **Map** (today's spec↔plan
    mirrored layout) and **Dependency**. The Dependency view is **plan
    only, leaf groups only** (groups with no child group — the "stories"),
    laid out by the `depends_on` relation. Nodes = leaf groups; edges =
    the dependency relation from `analysis.ts` (`dependencyAdjacency`,
    already `depends_on` + inverse `blocks`), restricted to leaves — a dep
    on a container fans out to its descendant leaves (mirroring how
    `schedule.ts` expands container endpoints to units). New pure
    `ui/depLayout.ts` (unit-tested, sibling of `graphLayout.ts`): a
    layered left→right DAG (prerequisites left, dependents right) by
    longest-path from sources; cycles are collapsed per Tarjan SCC
    (`dependencyCycles`) and drawn red + animated, reusing the Map view's
    convention. Nodes coloured per root group via `colors.ts`.
    Read-mostly first (pan/zoom/click-to-select), matching Graph's v1
    stance; drag-node-onto-node to author a `depends_on` edge is the
    natural follow-on (the current `DependencyEditor` is a text list).
    **Implicit sequential chain (advice on the open question):** yes to a
    default chain for siblings, but as a *display inference only* — for a
    set of sibling leaf groups with **no** explicit dep among them, ghost
    a sequential chain in sibling order (A→B→C), drawn dashed/muted to
    distinguish it from real edges, and **suppress it the moment any
    explicit dep exists among those siblings** ("unless otherwise
    defined"). Derive it purely in `depLayout.ts`; **never write it to the
    graph and never feed it to the scheduler** — the scheduler stays
    explicit-deps-only, so inferred edges can't silently move dates and
    the pure-projection rule holds. A toggle hides the inference; a later
    "materialise chain → real `depends_on` edges" action can promote it
    when you actually mean it.
19. ✅ Author dependencies in the Dependency view (drag-to-connect) — the
    read-mostly stance from slice 18 gains editing, but via **handle
    drag**, not node-onto-node drag (node-body drag fought the pan gesture
    and was unreliable). Each leaf-group node grows a handle on each side;
    grabbing a **handle** draws an arrow (React Flow's native connection),
    while grabbing the **body/pane** still pans — no gesture ambiguity.
    **Arrows follow the flow of work left→right** — prerequisite's right
    side into the dependent's left side, the arrowhead landing on the
    dependent (not backwards at the prerequisite). Authoring semantics come
    from **which side each card contributes, not which end starts the
    drag**: the card giving its **right** handle is the prerequisite, the
    card giving its **left** handle is the dependent, so left→right and
    right→left author the same `addEdge depends_on from=dependent
    to=prerequisite`. `connectionMode="loose"` lets either side start or
    receive; `isValidConnection` accepts only a left↔right pair (rejecting
    same-side l–l / r–r and self-links) and the `onConnect` commit no-ops a
    duplicate (mirrors `DependencyEditor`). A custom connection-line
    component previews the flow: a dashed line whose arrow always points at
    the **left** handle. **While a connection is in progress (authoring or
    reconnecting), each card reveals only its *valid* handle and hides the
    other** — pure `dragHandleVisibility(nodeId, fromNodeId, fromHandle)`
    in `depAuthoring.ts` (unit-tested) reads React Flow's live `useConnection`
    state: the from-card keeps its anchored side, every other card shows
    only the opposite side (the sole valid left↔right target). Cycles stay
    allowed — a new edge that closes a loop just renders as one. **Removing
    / moving a dependency is by *grabbing the arrow near one end*
    (reconnection), not a click**: only a **real, directly authored** edge
    (a single backing `depends_on`/inverse `blocks` edge between exactly
    those two leaves — found via `edgeBetween`) is `reconnectable`; grabbing
    an end detaches it and drags while the other stays anchored — drop it on
    a valid handle to re-home the dep (`onReconnect` = `removeEdge` old +
    `addEdge` new, atomic in one commit) or on empty space / an invalid
    handle to delete it (`onReconnectEnd` with a `reconnected` ref
    distinguishing the two; no confirm — the drag is the intent).
    Container-fan-out and inferred (dashed) edges are neither reconnectable
    nor deletable (no unambiguous single edge to remove). Still plan-only,
    leaf-only; `depLayout.ts` is unchanged (authoring mutates the graph, the
    layout re-projects). Only the Dependency view is connectable — the Map
    view keeps its HTML5 assignment drag untouched.

    UX + fixes pass (slices 20–24, from real-use feedback). All are
    **view/UI-layer changes over the existing graph — no new node/edge types,
    no model change** except slice 24, which only *simplifies the entry UI*
    over the unchanged `ExternalRef` shape. Each keeps the
    pure-helpers-in-`model`/`ui`, tested-domain rule.

20. ✅ Dependency-view crossing reduction — the layered left→right DAG in
    `depLayout.ts` ordered nodes within a layer by pre-order, so
    fan-out/fan-in (parallelisation) edges crossed badly and read as a
    dense grid. Add a Sugiyama-style **barycenter ordering** pass: after
    longest-path layering, run a fixed number of down/up sweeps that sort
    each layer by the mean order-index of its neighbours in the adjacent
    layer (pure, deterministic, stable-tie-broken by initial pre-order),
    then assign `y` from the resulting per-layer order. Pure + unit-tested
    in `depLayout.ts`; no change to columns (`x`) or the edge set.
21. ✅ Inferred chains coexist with explicit deps — `inferredChains` used to
    drop a sibling group's *entire* ghost chain the moment any explicit dep
    touched those siblings (all-or-nothing). Switch to **per-pair
    suppression** keyed on the **transitive** explicit relation: ghost a
    sequential edge between each consecutive sibling pair *unless the
    explicit dependencies already order those two siblings in either
    direction, directly or indirectly*. So the inference only fills in
    sequencing the explicit graph leaves genuinely undecided; it never
    contradicts an existing order (an early version keyed on *direct* edges
    only, so a pair ordered purely transitively still got a ghost edge that
    ran against the flow and closed a cycle — the tangle in the bug report).
    Still display-only — never written to the graph, never fed to the
    scheduler. Unit-tested (`transitiveNeeds` closure + contradiction case).
22. ✅ Structural-lock "phantom level" fix — locking N levels of a side that
    has fewer than N levels froze a level that doesn't exist yet, which
    hid the add-root / "Add the first item" button so you could never
    create the first node (and, more generally, the first child at a
    not-yet-existing depth). Fix: **clamp the effective lock depth to the
    number of levels that actually exist** on that side —
    `effective = min(configured, treeDepth(side))`. `isLocked` gains an
    optional `levelCount` arg (default ∞ = no clamp, so existing callers/
    tests are unchanged); `Outliner`/`PlanTable` pass the side's real
    `treeDepth`. An empty side clamps to 0 (nothing locked → create
    allowed); a roots-only side with a deeper lock still freezes the roots
    but lets you add children. UI-only, tested in `locks.test.ts`.
23. ✅ Cross-view navigation + de-truncation — read-only views (Table,
    Metrics, Timeline) truncate titles and offered no way back to a
    group's definition. Add an App-level `reveal(id)` that jumps to the
    node's home surface (group → Planning/outline, work → Spec) and
    selects it, threaded down as `onReveal`. **PlanTable**: a per-row "open
    in outline" (⤢) button + full-title `title` tooltip on the title
    input. **MetricsView**: est-vs-actual rows become clickable → reveal.
    **TimelineView**: row click reveals (was select-only). No model change.
24. ✅ Key entry, simplified — the external-ref entry UI asked for
    system + key + url; in practice everything is a Jira key. Extract a
    shared **`KeyEditor`** component: existing refs render as chips
    (keeping any `url` link + non-`jira` `system` label from imported
    data), and the add form is a **single key input that defaults
    `system: 'jira'`** (no url). Use it in `NodeMetaEditor` (replacing the
    three-field block) and add it as an editable **Keys** cell in
    `PlanTable` (was a read-only count) so keys are enterable from the
    table. The `ExternalRef` model (system/key/url) is untouched — the UI
    just narrows to key-only, leaving room to grow.

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
  with **squash** to keep `main`'s history linear (one commit per slice /
  change), and delete the branch. Wait for any CI checks before merging.
- Sandbox notes: npm registry access requires it to be enabled AND a fresh
  session; folder file deletion needs the allow-delete permission (git lock
  files trip this).
