import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addResource,
  assignResource,
  createGroup,
  emptyGraph,
  setActualDates,
  setEstimate,
  updateSettings,
} from './graph.ts';
import { assigneeMetrics, weekStart } from './assigneeMetrics.ts';
import type { ProjectGraph } from './types.ts';

function base(): ProjectGraph {
  return updateSettings(emptyGraph(), { startDate: '2024-01-01' });
}
/** A completed unit: estimate days/points, actual dates, optional resource. */
function done(
  g: ProjectGraph,
  id: string,
  opts: { days?: number | null; points?: number; start: string; finish: string; resource?: string },
): ProjectGraph {
  g = createGroup(g, { id, title: id });
  g = setEstimate(g, id, {
    durationEstimate: opts.days === undefined ? 0 : opts.days,
    effort: opts.points ?? 0,
  });
  g = setActualDates(g, id, { actualStart: opts.start, actualFinish: opts.finish });
  if (opts.resource) g = assignResource(g, id, opts.resource);
  return g;
}
function row(g: ProjectGraph, name: string) {
  return assigneeMetrics(g).rows.find((r) => r.name === name);
}

describe('weekStart', () => {
  it('snaps to the Monday of the week', () => {
    assert.equal(weekStart('2024-01-03'), '2024-01-01'); // Wed → Mon
    assert.equal(weekStart('2024-01-01'), '2024-01-01'); // Mon → itself
    assert.equal(weekStart('2024-01-07'), '2024-01-01'); // Sun → prior Mon
    assert.equal(weekStart('2024-01-08'), '2024-01-08'); // next Mon
  });
});

describe('assigneeMetrics — rows', () => {
  it('lists every resource in settings order, Unassigned last only if used', () => {
    let g = base();
    g = addResource(g, { id: 'r1', name: 'Ana', fte: 1 });
    g = addResource(g, { id: 'r2', name: 'Bo', fte: 0.5 });
    // No Unassigned completed work yet.
    g = done(g, 'a', { days: 2, points: 3, start: '2024-01-01', finish: '2024-01-02', resource: 'r1' });
    assert.deepEqual(
      assigneeMetrics(g).rows.map((r) => r.name),
      ['Ana', 'Bo'],
    );

    // Add an unassigned completed unit → Unassigned row appears, last.
    g = done(g, 'b', { days: 1, points: 1, start: '2024-01-03', finish: '2024-01-03' });
    assert.deepEqual(
      assigneeMetrics(g).rows.map((r) => r.name),
      ['Ana', 'Bo', 'Unassigned'],
    );
  });

  it('aggregates estimate vs actual and points/day per assignee', () => {
    let g = base();
    g = addResource(g, { id: 'r1', name: 'Ana', fte: 1 });
    // Two completed units for Ana: estimate 2+2 = 4d, actual Mon..Tue (1
    // elapsed day) and Mon..Thu (3 elapsed days) = 4d; 3+5 = 8 points.
    g = done(g, 'a', { days: 2, points: 3, start: '2024-01-01', finish: '2024-01-02', resource: 'r1' });
    g = done(g, 'b', { days: 2, points: 5, start: '2024-01-01', finish: '2024-01-04', resource: 'r1' });
    const ana = row(g, 'Ana')!;
    assert.equal(ana.completedCount, 2);
    assert.equal(ana.estimateDays, 4);
    assert.equal(ana.actualDays, 4);
    assert.equal(ana.varianceDays, 0); // 4 actual − 4 estimate
    assert.equal(ana.points, 8);
    assert.equal(ana.pointsPerDay, 2);
    assert.equal(ana.fte, 1);
  });

  it('reports zeros and null points/day for a resource with no completed work', () => {
    let g = base();
    g = addResource(g, { id: 'r1', name: 'Ana', fte: 1 });
    const ana = row(g, 'Ana')!;
    assert.equal(ana.completedCount, 0);
    assert.equal(ana.actualDays, 0);
    assert.equal(ana.pointsPerDay, null);
  });

  it('counts only completed units (skips in-progress / not-started)', () => {
    let g = base();
    g = addResource(g, { id: 'r1', name: 'Ana', fte: 1 });
    g = done(g, 'a', { days: 2, points: 3, start: '2024-01-01', finish: '2024-01-02', resource: 'r1' });
    // in progress (start only) — must be ignored
    g = createGroup(g, { id: 'b', title: 'b' });
    g = setEstimate(g, 'b', { durationEstimate: 5, effort: 8 });
    g = setActualDates(g, 'b', { actualStart: '2024-01-03' });
    g = assignResource(g, 'b', 'r1');
    const ana = row(g, 'Ana')!;
    assert.equal(ana.completedCount, 1);
    assert.equal(ana.points, 3);
  });

  it('treats a dangling resourceId as Unassigned', () => {
    let g = base();
    g = addResource(g, { id: 'r1', name: 'Ana', fte: 1 });
    g = done(g, 'a', { days: 1, points: 2, start: '2024-01-01', finish: '2024-01-01', resource: 'r1' });
    // Remove the resource but keep the assignment id dangling by editing settings.
    g = updateSettings(g, { resources: [] });
    const m = assigneeMetrics(g);
    assert.deepEqual(m.rows.map((r) => r.name), ['Unassigned']);
    assert.equal(m.rows[0]!.points, 2);
  });
});

describe('assigneeMetrics — weekly histogram', () => {
  it('builds a gapless week axis and buckets points/count per assignee', () => {
    let g = base();
    g = addResource(g, { id: 'r1', name: 'Ana', fte: 1 });
    g = addResource(g, { id: 'r2', name: 'Bo', fte: 1 });
    // Ana: week of Jan 1 (finish Jan 3) and week of Jan 15 (finish Jan 16).
    g = done(g, 'a', { days: 1, points: 3, start: '2024-01-03', finish: '2024-01-03', resource: 'r1' });
    g = done(g, 'b', { days: 1, points: 2, start: '2024-01-16', finish: '2024-01-16', resource: 'r1' });
    // Bo: week of Jan 8 (finish Jan 9).
    g = done(g, 'c', { days: 1, points: 5, start: '2024-01-09', finish: '2024-01-09', resource: 'r2' });

    const m = assigneeMetrics(g);
    // Gapless Mondays: Jan 1, Jan 8, Jan 15.
    assert.deepEqual(m.weekStarts, ['2024-01-01', '2024-01-08', '2024-01-15']);
    assert.equal(m.maxWeekPoints, 5); // Bo's single week

    const ana = m.series.find((s) => s.name === 'Ana')!;
    assert.deepEqual(
      ana.weeks.map((w) => w.points),
      [3, 0, 2],
    );
    const bo = m.series.find((s) => s.name === 'Bo')!;
    assert.deepEqual(
      bo.weeks.map((w) => w.points),
      [0, 5, 0],
    );
    assert.deepEqual(bo.weeks.map((w) => w.count), [0, 1, 0]);
  });

  it('has an empty week axis when nothing is completed', () => {
    let g = base();
    g = addResource(g, { id: 'r1', name: 'Ana', fte: 1 });
    const m = assigneeMetrics(g);
    assert.deepEqual(m.weekStarts, []);
    assert.equal(m.maxWeekPoints, 0);
  });
});
