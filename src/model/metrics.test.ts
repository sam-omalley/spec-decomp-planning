import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGroup,
  emptyGraph,
  setActualDates,
  setEstimate,
  updateSettings,
} from './graph.ts';
import {
  burnUp,
  estimateVsActual,
  projectionSummary,
  workingDaysInclusive,
} from './metrics.ts';
import type { ProjectGraph } from './types.ts';

// e1 (2d/3pt) done but ran 3 working days; e2 (2d/5pt) not started.
function fixture(): ProjectGraph {
  let g = emptyGraph();
  g = updateSettings(g, { startDate: '2024-01-01', targetDate: '2024-01-04' });
  g = createGroup(g, { id: 'e1', title: 'Epic 1' });
  g = createGroup(g, { id: 'e2', title: 'Epic 2' });
  g = setEstimate(g, 'e1', { durationEstimate: 2, effort: 3 });
  g = setEstimate(g, 'e2', { durationEstimate: 2, effort: 5 });
  g = setActualDates(g, 'e1', { actualStart: '2024-01-01', actualFinish: '2024-01-03' });
  return g;
}

describe('workingDaysInclusive', () => {
  it('counts Mon–Fri as 5 and skips the weekend', () => {
    assert.equal(workingDaysInclusive('2024-01-01', '2024-01-05'), 5);
    assert.equal(workingDaysInclusive('2024-01-01', '2024-01-08'), 6); // +Mon, Sat/Sun skipped
    assert.equal(workingDaysInclusive('2024-01-05', '2024-01-01'), 0); // reversed
  });
});

describe('projectionSummary', () => {
  it('totals scope, remaining, and variance vs target', () => {
    const s = projectionSummary(fixture());
    assert.equal(s.totalDays, 4);
    assert.equal(s.doneDays, 2);
    assert.equal(s.remainingDays, 2);
    assert.equal(s.totalPoints, 8);
    assert.equal(s.remainingPoints, 5);
    assert.equal(s.projectFinish, '2024-01-03');
    assert.equal(s.varianceDays, -1); // finishes a day before the Jan-4 target
    assert.equal(s.onTrack, true);
  });

  it('has null variance with no target date', () => {
    let g = fixture();
    g = updateSettings(g, { targetDate: null });
    const s = projectionSummary(g);
    assert.equal(s.varianceDays, null);
    assert.equal(s.onTrack, null);
  });
});

describe('estimateVsActual', () => {
  it('reports done units only, with per-row and rolled variance', () => {
    const e = estimateVsActual(fixture());
    assert.equal(e.rows.length, 1); // e2 is not done
    assert.deepEqual(e.rows[0], {
      id: 'e1',
      title: 'Epic 1',
      estimateDays: 2,
      actualDays: 3,
      varianceDays: 1, // took a day longer than estimated
    });
    assert.equal(e.totalEstimate, 2);
    assert.equal(e.totalActual, 3);
  });
});

describe('burnUp', () => {
  it('steps cumulative done up at each actual finish against a constant total', () => {
    assert.deepEqual(burnUp(fixture()), [
      { date: '2024-01-01', done: 0, total: 4 },
      { date: '2024-01-03', done: 2, total: 4 },
    ]);
  });
});
