import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  captureBaseline,
  createGroup,
  deleteNode,
  emptyGraph,
  setActualDates,
  setEstimate,
  updateSettings,
} from './graph.ts';
import { computeDrift } from './baselineDrift.ts';
import type { ProjectGraph } from './types.ts';

// 2024-01-01 is a Monday, so working-day offset i maps to a known date:
// 0=Jan1 Mon, 1=Jan2, 2=Jan3, 3=Jan4, 4=Jan5 Fri, 5=Jan8 Mon, 6=Jan9…
function base(): ProjectGraph {
  return updateSettings(emptyGraph(), { startDate: '2024-01-01' });
}

function group(g: ProjectGraph, id: string, days: number | null, parent?: string): ProjectGraph {
  g = createGroup(g, { id, title: id }, parent);
  if (days !== null) g = setEstimate(g, id, { durationEstimate: days });
  return g;
}

describe('computeDrift (#131)', () => {
  it('reports no drift when nothing has changed since capture', () => {
    let g = base();
    g = group(g, 'a', 5);
    g = captureBaseline(g, 'v1', '2024-01-01');
    const baseline = g.settings.baselines[0]!;
    const drift = computeDrift(g, baseline, '2024-01-01');
    assert.equal(drift.finishDeltaDays, 0);
    assert.equal(drift.baselineFinish, drift.currentFinish);
    assert.deepEqual(drift.unitsAdded, []);
    assert.deepEqual(drift.unitsRemoved, []);
    assert.deepEqual(drift.estimateChanges, []);
    assert.deepEqual(drift.lateStarts, []);
  });

  it('reports a unit added after capture, and the finish slip it causes', () => {
    let g = base();
    g = group(g, 'a', 5);
    g = captureBaseline(g, 'v1', '2024-01-01');
    const baseline = g.settings.baselines[0]!;
    g = group(g, 'z', 5); // queues behind 'a' on the single implicit track
    const drift = computeDrift(g, baseline, '2024-01-01');
    assert.deepEqual(drift.unitsAdded, [{ id: 'z', title: 'z' }]);
    assert.deepEqual(drift.unitsRemoved, []);
    assert.ok(drift.finishDeltaDays !== null && drift.finishDeltaDays > 0);
  });

  it('reports a unit removed after capture', () => {
    let g = base();
    g = group(g, 'a', 5);
    g = group(g, 'b', 3);
    g = captureBaseline(g, 'v1', '2024-01-01');
    const baseline = g.settings.baselines[0]!;
    g = deleteNode(g, 'b');
    const drift = computeDrift(g, baseline, '2024-01-01');
    assert.deepEqual(drift.unitsRemoved, [{ id: 'b', title: 'b' }]);
  });

  it('reports an estimate revision for a unit that still exists', () => {
    let g = base();
    g = group(g, 'a', 3);
    g = captureBaseline(g, 'v1', '2024-01-01');
    const baseline = g.settings.baselines[0]!;
    g = setEstimate(g, 'a', { durationEstimate: 8 });
    const drift = computeDrift(g, baseline, '2024-01-01');
    assert.deepEqual(drift.estimateChanges, [{ id: 'a', title: 'a', before: 3, after: 8 }]);
    assert.ok(drift.finishDeltaDays !== null && drift.finishDeltaDays > 0);
  });

  it('does not double-report an added unit as an estimate change', () => {
    let g = base();
    g = captureBaseline(g, 'v1', '2024-01-01'); // nothing exists yet
    const baseline = g.settings.baselines[0]!;
    g = group(g, 'a', 5);
    const drift = computeDrift(g, baseline, '2024-01-01');
    assert.deepEqual(drift.unitsAdded, [{ id: 'a', title: 'a' }]);
    assert.deepEqual(drift.estimateChanges, []);
  });

  it('reports a unit that started later than its baseline projection', () => {
    let g = base();
    g = group(g, 'a', 5);
    g = captureBaseline(g, 'v1', '2024-01-01');
    const baseline = g.settings.baselines[0]!;
    g = setActualDates(g, 'a', { actualStart: '2024-01-08' });
    const drift = computeDrift(g, baseline, '2024-01-01');
    assert.equal(drift.lateStarts.length, 1);
    assert.deepEqual(drift.lateStarts[0], {
      id: 'a',
      title: 'a',
      baselineStart: '2024-01-01',
      currentStart: '2024-01-08',
      deltaDays: 5,
    });
  });

  it('compares against multiple independently-captured baselines correctly', () => {
    let g = base();
    g = group(g, 'a', 3);
    g = captureBaseline(g, 'v1', '2024-01-01');
    const v1 = g.settings.baselines[0]!;
    g = setEstimate(g, 'a', { durationEstimate: 8 });
    g = captureBaseline(g, 'v2', '2024-01-01');
    const v2 = g.settings.baselines.find((b) => b.label === 'v2')!;
    assert.equal(computeDrift(g, v1, '2024-01-01').estimateChanges.length, 1);
    assert.equal(computeDrift(g, v2, '2024-01-01').estimateChanges.length, 0);
  });
});
