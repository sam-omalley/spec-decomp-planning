/**
 * What-if scenarios: an ephemeral settings override held in view-layer
 * React state, never written to the graph/store — analogous to how
 * search/filter/depth-cap state already bypasses the graph. Scoped to
 * settings only (team + speed multiplier), not per-node estimate edits:
 * enough to answer "what if we add a person" or "what if we sped up",
 * without needing a scratch copy of the spec/plan or a merge step for
 * node-level overrides.
 */

import type { ProjectGraph, ProjectSettings, Resource } from '../model/types.ts';

export interface ScenarioPatch {
  resources: Resource[];
  speedMultiplier: number;
}

/** A scenario's starting point: a working copy of the real team + speed,
 *  so the first edit diverges from — not replaces — the real settings. */
export function scenarioFrom(settings: ProjectSettings): ScenarioPatch {
  return {
    resources: settings.resources.map((r) => ({ ...r })),
    speedMultiplier: settings.speedMultiplier,
  };
}

/** Overlays a scenario patch onto `graph`'s settings only — nodes/edges are
 *  never touched, so every other read (titles, dependencies, ...) is safe
 *  to make against the returned graph exactly as it would be against the
 *  real one. */
export function applyScenario(graph: ProjectGraph, patch: ScenarioPatch | null): ProjectGraph {
  if (!patch) return graph;
  return { ...graph, settings: { ...graph.settings, ...patch } };
}
