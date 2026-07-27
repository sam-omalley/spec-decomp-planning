import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMilestone,
  assignMilestone,
  createGroup,
  emptyGraph,
  setEstimate,
  updateNode,
  updateSettings,
} from './graph.ts';
import { milestoneOf, milestoneSummaries } from './milestones.ts';
import type { ProjectGraph } from './types.ts';

/** A plan with one release (R1: Jan 1 → Jan 10) and no commitments yet. */
function base(): ProjectGraph {
  let g = updateSettings(emptyGraph(), { startDate: '2024-01-01' });
  g = addMilestone(g, { id: 'r1', name: 'R1', startDate: '2024-01-01', targetDate: '2024-01-10' });
  return g;
}
function group(g: ProjectGraph, id: string, days: number | null, parent?: string): ProjectGraph {
  g = createGroup(g, { id, title: id.toUpperCase() }, parent);
  if (days !== null) g = setEstimate(g, id, { durationEstimate: days });
  return g;
}

describe('milestoneOf', () => {
  it('inherits the nearest ancestor’s milestone', () => {
    let g = base();
    g = group(g, 'block', null);
    g = group(g, 'epic', null, 'block');
    g = group(g, 'story', 2, 'epic');
    g = assignMilestone(g, 'block', 'r1');
    assert.equal(milestoneOf(g, 'block'), 'r1');
    assert.equal(milestoneOf(g, 'epic'), 'r1');
    assert.equal(milestoneOf(g, 'story'), 'r1');
  });

  it('lets a descendant override its ancestor', () => {
    let g = base();
    g = addMilestone(g, { id: 'r2', name: 'R2', startDate: '2024-02-01', targetDate: '2024-02-20' });
    g = group(g, 'block', null);
    g = group(g, 'a', 2, 'block');
    g = group(g, 'b', 2, 'block');
    g = assignMilestone(g, 'block', 'r1');
    g = assignMilestone(g, 'b', 'r2');
    assert.equal(milestoneOf(g, 'a'), 'r1');
    assert.equal(milestoneOf(g, 'b'), 'r2');
  });

  it('is null with nothing committed up the chain', () => {
    let g = base();
    g = group(g, 'a', 2);
    assert.equal(milestoneOf(g, 'a'), null);
  });

  it('treats a dangling milestoneId as uncommitted', () => {
    let g = base();
    g = group(g, 'a', 2);
    g = assignMilestone(g, 'a', 'r1');
    // Drop the milestone straight through settings, bypassing removeMilestone's
    // reference cleanup — the same shape a hand-edited file could arrive in.
    g = updateSettings(g, { milestones: [] });
    assert.equal(milestoneOf(g, 'a'), null);
  });
});

describe('milestoneSummaries', () => {
  it('rolls committed units up into the release, driven by the last finish', () => {
    let g = base();
    g = group(g, 'block', null);
    g = group(g, 'a', 2, 'block');
    g = group(g, 'b', 3, 'block');
    g = assignMilestone(g, 'block', 'r1');
    const [r1] = milestoneSummaries(g);
    assert.deepEqual(r1!.unitIds, ['a', 'b']); // inherited from the block
    assert.equal(r1!.totalDays, 5);
    assert.equal(r1!.start, '2024-01-01');
    assert.equal(r1!.finish, '2024-01-05'); // a Mon-Tue, b Wed-Fri on one track
    assert.equal(r1!.drivingUnit!.id, 'b');
    assert.equal(r1!.varianceDays, -5); // 5 calendar days before the Jan-10 target
    assert.equal(r1!.onTrack, true);
  });

  it('reports a release whose committed work runs past its target', () => {
    let g = base();
    g = group(g, 'a', 15);
    g = assignMilestone(g, 'a', 'r1');
    const [r1] = milestoneSummaries(g);
    assert.equal(r1!.finish, '2024-01-19');
    assert.equal(r1!.varianceDays, 9);
    assert.equal(r1!.onTrack, false);
    assert.equal(r1!.drivingUnit!.title, 'A');
  });

  it('counts done units and their days separately', () => {
    let g = base();
    g = group(g, 'a', 2);
    g = group(g, 'b', 3);
    g = assignMilestone(g, 'a', 'r1');
    g = assignMilestone(g, 'b', 'r1');
    g = updateNode(g, 'a', { status: 'done' });
    const [r1] = milestoneSummaries(g);
    assert.equal(r1!.doneCount, 1);
    assert.equal(r1!.doneDays, 2);
    assert.equal(r1!.totalDays, 5);
  });

  it('returns an empty release as neither on nor off track', () => {
    let g = base();
    g = group(g, 'a', 2); // uncommitted
    const [r1] = milestoneSummaries(g);
    assert.deepEqual(r1!.unitIds, []);
    assert.equal(r1!.finish, null);
    assert.equal(r1!.varianceDays, null);
    assert.equal(r1!.onTrack, null);
  });

  it('ignores a commitment on a parked group (never scheduled)', () => {
    let g = base();
    g = group(g, 'a', 2);
    g = updateNode(g, 'a', { parkingLot: true });
    g = assignMilestone(g, 'a', 'r1');
    const [r1] = milestoneSummaries(g);
    assert.deepEqual(r1!.unitIds, []);
  });

  it('names an untitled release rather than showing a blank', () => {
    let g = updateSettings(emptyGraph(), { startDate: '2024-01-01' });
    g = addMilestone(g, { id: 'r', name: '  ', startDate: '2024-01-01', targetDate: '2024-01-10' });
    assert.equal(milestoneSummaries(g)[0]!.name, 'Untitled milestone');
  });
});
