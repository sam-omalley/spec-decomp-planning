import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignResource,
  createGroup,
  emptyGraph,
  setEstimate,
  updateSettings,
} from './graph.ts';
import { forwardLoad } from './forwardLoad.ts';
import type { ProjectGraph } from './types.ts';

// 2024-01-01 is a Monday.
function base(overrides: Partial<Parameters<typeof updateSettings>[1]> = {}): ProjectGraph {
  let g = emptyGraph();
  g = updateSettings(g, { startDate: '2024-01-01', ...overrides });
  return g;
}

function group(g: ProjectGraph, id: string, days: number): ProjectGraph {
  g = createGroup(g, { id, title: id });
  return setEstimate(g, id, { durationEstimate: days });
}

describe('forwardLoad', () => {
  it('is empty when there is no team', () => {
    let g = base();
    g = group(g, 'a', 5);
    assert.deepEqual(forwardLoad(g), { weekStarts: [], resources: [] });
  });

  it('starts the week axis at the week containing `now` and spans the horizon', () => {
    const g = base({
      resources: [
        { id: 'r0', name: 'Ada', fte: 1, leave: [], availableFrom: null, availableUntil: null },
      ],
    });
    const m = forwardLoad(g, '2024-01-01', 3);
    assert.deepEqual(m.weekStarts, ['2024-01-01', '2024-01-08', '2024-01-15']);
  });

  it('fully books a resource whose track a 5-day unit fills, leaves an idle one alone', () => {
    let g = base({
      resources: [
        { id: 'r0', name: 'Ada', fte: 1, leave: [], availableFrom: null, availableUntil: null },
        { id: 'r1', name: 'Bo', fte: 1, leave: [], availableFrom: null, availableUntil: null },
      ],
    });
    g = group(g, 'a', 5); // Mon..Fri, pinned to r0
    g = assignResource(g, 'a', 'r0');
    const m = forwardLoad(g);
    const ada = m.resources.find((r) => r.id === 'r0')!;
    const bo = m.resources.find((r) => r.id === 'r1')!;
    assert.deepEqual(ada.weeks[0], {
      weekStart: '2024-01-01',
      capacityDays: 5,
      committedDays: 5,
      utilization: 1,
    });
    assert.deepEqual(bo.weeks[0], {
      weekStart: '2024-01-01',
      capacityDays: 5,
      committedDays: 0,
      utilization: 0,
    });
  });

  it('counts an unassigned unit against whichever track it auto-placed onto', () => {
    let g = base({
      resources: [
        { id: 'r0', name: 'Ada', fte: 1, leave: [], availableFrom: null, availableUntil: null },
      ],
    });
    g = group(g, 'a', 2); // unassigned, but only one track exists
    const m = forwardLoad(g);
    assert.equal(m.resources[0]!.weeks[0]!.committedDays, 2);
  });

  it('reduces capacity for everyone on a project holiday', () => {
    let g = base({
      resources: [
        { id: 'r0', name: 'Ada', fte: 1, leave: [], availableFrom: null, availableUntil: null },
      ],
      holidays: [{ start: '2024-01-03', end: '2024-01-03' }], // Wed
    });
    const m = forwardLoad(g);
    assert.equal(m.resources[0]!.weeks[0]!.capacityDays, 4);
  });

  it("reduces capacity only for the resource on leave, not a track-mate", () => {
    let g = base({
      resources: [
        {
          id: 'r0', name: 'Ada', fte: 1,
          leave: [{ start: '2024-01-03', end: '2024-01-03' }],
          availableFrom: null, availableUntil: null,
        },
        { id: 'r1', name: 'Bo', fte: 1, leave: [], availableFrom: null, availableUntil: null },
      ],
    });
    const m = forwardLoad(g);
    assert.equal(m.resources.find((r) => r.id === 'r0')!.weeks[0]!.capacityDays, 4);
    assert.equal(m.resources.find((r) => r.id === 'r1')!.weeks[0]!.capacityDays, 5);
  });

  it('reports zero utilization (not NaN) for a resource on leave the whole week', () => {
    let g = base({
      resources: [
        {
          id: 'r0', name: 'Ada', fte: 1,
          leave: [{ start: '2024-01-01', end: '2024-01-05' }],
          availableFrom: null, availableUntil: null,
        },
      ],
    });
    const m = forwardLoad(g);
    assert.deepEqual(m.resources[0]!.weeks[0], {
      weekStart: '2024-01-01',
      capacityDays: 0,
      committedDays: 0,
      utilization: 0,
    });
  });

  it('credits no capacity to a resource once they have left (#161)', () => {
    const g = base({
      resources: [
        {
          id: 'r0', name: 'Ada', fte: 1, leave: [],
          availableFrom: null, availableUntil: '2024-01-03', // Wed
        },
      ],
    });
    const m = forwardLoad(g, '2024-01-01', 2);
    assert.equal(m.resources[0]!.weeks[0]!.capacityDays, 3); // Mon..Wed only
    assert.equal(m.resources[0]!.weeks[1]!.capacityDays, 0); // gone by then
    assert.equal(m.resources[0]!.name, 'Ada'); // still on the roster
  });

  it('credits no capacity to a resource before they join', () => {
    const g = base({
      resources: [
        {
          id: 'r0', name: 'New', fte: 1, leave: [],
          availableFrom: '2024-01-10', availableUntil: null, // Wed of week 2
        },
      ],
    });
    const m = forwardLoad(g, '2024-01-01', 2);
    assert.equal(m.resources[0]!.weeks[0]!.capacityDays, 0);
    assert.equal(m.resources[0]!.weeks[1]!.capacityDays, 3); // Wed..Fri
  });
});
