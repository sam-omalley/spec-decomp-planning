import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGroup, emptyGraph, setActualDates, setEstimate, updateSettings } from './graph.ts';
import { scheduleProject } from './schedule.ts';
import { historicalAccuracy, sampleProjection } from './uncertainty.ts';
import type { ProjectGraph } from './types.ts';

// 2024-01-01 is a Monday.
function base(): ProjectGraph {
  let g = emptyGraph();
  g = updateSettings(g, { startDate: '2024-01-01' });
  return g;
}

function group(g: ProjectGraph, id: string, days: number | null): ProjectGraph {
  g = createGroup(g, { id, title: id });
  if (days !== null) g = setEstimate(g, id, { durationEstimate: days });
  return g;
}

describe('historicalAccuracy', () => {
  it('is null below the minimum completed-unit sample size', () => {
    let g = base();
    g = group(g, 'a', 2);
    g = setActualDates(g, 'a', { actualStart: '2024-01-01', actualFinish: '2024-01-04' });
    assert.equal(historicalAccuracy(g), null);
  });

  it('derives the mean and spread of actual÷estimate across completed units', () => {
    let g = base();
    g = group(g, 'a', 2); // Mon→Thu = 3 elapsed days, ratio 1.5
    g = setActualDates(g, 'a', { actualStart: '2024-01-01', actualFinish: '2024-01-04' });
    g = group(g, 'b', 4); // Mon→Fri = 4 elapsed days, ratio 1.0
    g = setActualDates(g, 'b', { actualStart: '2024-01-08', actualFinish: '2024-01-12' });
    const h = historicalAccuracy(g);
    assert.ok(h !== null);
    assert.equal(h!.meanRatio, 1.25);
    assert.equal(h!.spread, 0.25);
  });
});

describe('sampleProjection', () => {
  it('is identical to the deterministic finish with no ranges and no history', () => {
    let g = base();
    g = group(g, 'a', 5);
    const schedule = scheduleProject(g);
    const sampled = sampleProjection(g, undefined, schedule);
    assert.equal(sampled.hasUncertainty, false);
    assert.equal(sampled.p50, schedule.projectFinish);
    assert.equal(sampled.p80, schedule.projectFinish);
  });

  it('samples within the explicit [optimistic, pessimistic] bounds', () => {
    let g = base();
    g = group(g, 'a', 5);
    g = setEstimate(g, 'a', { durationOptimistic: 3, durationPessimistic: 11 });
    const sampled = sampleProjection(g, undefined, undefined, { samples: 200, seed: 42 });
    assert.equal(sampled.hasUncertainty, true);
    const lower = scheduleProject(g, undefined, new Map([['a', 3]])).projectFinish!;
    const upper = scheduleProject(g, undefined, new Map([['a', 11]])).projectFinish!;
    assert.ok(sampled.p50! >= lower && sampled.p50! <= upper);
    assert.ok(sampled.p80! >= sampled.p50!);
    assert.ok(sampled.p80! <= upper);
  });

  it('is deterministic for a given seed', () => {
    let g = base();
    g = group(g, 'a', 5);
    g = setEstimate(g, 'a', { durationOptimistic: 2, durationPessimistic: 9 });
    const r1 = sampleProjection(g, undefined, undefined, { samples: 60, seed: 7 });
    const r2 = sampleProjection(g, undefined, undefined, { samples: 60, seed: 7 });
    assert.deepEqual(r1, r2);
  });

  it('ignores a lone optimistic/pessimistic bound (needs both)', () => {
    let g = base();
    g = group(g, 'a', 5);
    g = setEstimate(g, 'a', { durationOptimistic: 1 });
    const schedule = scheduleProject(g);
    const sampled = sampleProjection(g, undefined, schedule);
    assert.equal(sampled.hasUncertainty, false);
    assert.equal(sampled.p50, schedule.projectFinish);
  });

  it('done units contribute no uncertainty even with a range set', () => {
    let g = base();
    g = group(g, 'a', 2);
    g = setEstimate(g, 'a', { durationOptimistic: 1, durationPessimistic: 10 });
    g = setActualDates(g, 'a', { actualStart: '2024-01-01', actualFinish: '2024-01-02' });
    const schedule = scheduleProject(g);
    const sampled = sampleProjection(g, undefined, schedule);
    assert.equal(sampled.hasUncertainty, false);
    assert.equal(sampled.p50, schedule.projectFinish);
  });
});
