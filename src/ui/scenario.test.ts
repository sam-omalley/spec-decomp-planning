import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addResource, emptyGraph, updateSettings } from '../model/graph.ts';
import { applyScenario, scenarioFrom } from './scenario.ts';

describe('scenarioFrom', () => {
  it('copies the real team and speed multiplier as a starting point', () => {
    let g = emptyGraph();
    g = addResource(g, { id: 'r1', name: 'Ada', fte: 1 });
    g = updateSettings(g, { speedMultiplier: 1.5 });
    const scenario = scenarioFrom(g.settings);
    assert.deepEqual(scenario, {
      resources: [{ id: 'r1', name: 'Ada', fte: 1, leave: [] }],
      speedMultiplier: 1.5,
    });
  });

  it('is a deep copy — mutating the scenario never touches the real settings', () => {
    let g = emptyGraph();
    g = addResource(g, { id: 'r1', name: 'Ada', fte: 1 });
    const scenario = scenarioFrom(g.settings);
    scenario.resources[0]!.fte = 0.5;
    assert.equal(g.settings.resources[0]!.fte, 1);
  });
});

describe('applyScenario', () => {
  it('is a no-op when there is no active scenario', () => {
    const g = emptyGraph();
    assert.equal(applyScenario(g, null), g);
  });

  it('overlays only settings — nodes and edges are the same reference', () => {
    let g = emptyGraph();
    g = addResource(g, { id: 'r1', name: 'Ada', fte: 1 });
    const scenario = scenarioFrom(g.settings);
    scenario.speedMultiplier = 2;
    scenario.resources.push({ id: 'r2', name: 'Bo', fte: 1, leave: [] });
    const overlaid = applyScenario(g, scenario);
    assert.equal(overlaid.nodes, g.nodes);
    assert.equal(overlaid.edges, g.edges);
    assert.equal(overlaid.settings.speedMultiplier, 2);
    assert.equal(overlaid.settings.resources.length, 2);
    // The real graph is untouched.
    assert.equal(g.settings.speedMultiplier, 1);
    assert.equal(g.settings.resources.length, 1);
  });
});
