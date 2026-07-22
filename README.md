# Planning Tool

[![Deploy to GitHub Pages](https://github.com/sam-omalley/spec-decomp-planning/actions/workflows/deploy.yml/badge.svg)](https://github.com/sam-omalley/spec-decomp-planning/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**A graph-based planning tool that turns a high-level specification into an implementation plan through iterative decomposition and regrouping.**

### ▶ [Try it live](https://sam-omalley.github.io/spec-decomp-planning/)

Everything runs in your browser — no account, no server. Your work autosaves locally (IndexedDB) and can be exported to / imported from `.json`.

## The idea

Not a mind map. **Decomposition** (breaking a spec into nested requirements, features, tasks…) and **delivery planning** (grouping that work into blocks and epics) are treated as two independent projections of *one underlying graph*, symmetric by design:

- Reshaping the spec hierarchy never destroys planning information.
- Reassigning work to delivery groups never changes the decomposition.

There is deliberately no rigid "plan / epic / block" hierarchy — just groups nesting in groups to whatever depth the work needs.

## Views

Every view is a pure projection of the same graph, kept in sync:

- **Spec outliner** — decompose the specification. Keyboard-first (`Enter` = sibling, `Tab` = indent), Things-style inline detail cards (`⌘↩`). Purely structural: no estimates, no dependencies — just what must be built.
- **Planning view** — the delivery forest (outline or table), the thing you actually estimate, track, and sequence. Drag spec rows onto groups to assign; coverage and overlap are shown as chips and badges.
- **Graph view** — the whole graph at once: spec forest left-to-right, delivery forest mirrored right-to-left, with `assigned_to` edges bridging the two (Map mode) or the delivery groups' dependency graph, lag/lead and start-to-start included (Dependency mode, with Tarjan cycle detection — cycles are visualized, never forbidden).
- **Markdown view** — the delivery plan rendered as copyable Markdown for export.
- **Reporting** — Timeline (Gantt, with a P80 uncertainty whisker), Metrics (projected finish, burn-up, estimate-vs-actual, a sampled P50/P80 projection range), Assignees (per-resource stats), Concerns (overdue/blocked/cycle/unestimated/unassigned flags), and Coverage (spec items no group addresses).
- **Settings** — schedule (start/target dates, holidays), the delivery team (FTE, individual leave), points↔days conversion, editing locks, and named baselines to diff the current plan against.

Plus a resource-constrained **scheduler** (skip-weekends calendar, capacity per team member), **what-if scenarios** (preview a team/speed change without touching the plan), any number of **local projects** with a header switcher, CSV export, and full **undo/redo**.

## Tech

React 19 · Vite 6 · TypeScript (strict) · [@xyflow/react](https://reactflow.dev) for the graph. A dependency-free domain core with immutable, structurally-shared mutations and a snapshot-based undo stack — no state-management library.

## Development

```bash
npm install     # only needed for the Vite dev server
npm run dev     # start the dev server
npm test        # run the domain test suite (Node's built-in runner, no deps)
npm run build   # type-check + production build to dist/
```

The core and tests run without `npm install`. Tests require Node **22.6+** (the suite uses `--experimental-strip-types`).

## Deployment

Pushing to `main` triggers [the GitHub Actions workflow](.github/workflows/deploy.yml), which tests, builds, and deploys to GitHub Pages automatically.

## License

[MIT](LICENSE) © Samuel O'Malley
