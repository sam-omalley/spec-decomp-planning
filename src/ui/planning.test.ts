import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignToEpic,
  createEpic,
  createNode,
  createPlan,
  emptyGraph,
} from '../model/graph.ts';
import type { ProjectGraph } from '../model/types.ts';
import {
  coveringEpicsInPlan,
  epicsOfPlanOrdered,
  overlappingMembers,
  plansOrdered,
} from './planning.ts';

/**
 * app
 * ├─ auth
 * │  ├─ login
 * │  └─ signup
 * └─ billing
 * Plans: p1 (e1, e2), p2 (e3).
 */
function fixture(): ProjectGraph {
  let g = emptyGraph();
  g = createNode(g, { id: 'app', title: 'App' });
  g = createNode(g, { id: 'auth', title: 'Auth' }, 'app');
  g = createNode(g, { id: 'login', title: 'Login' }, 'auth');
  g = createNode(g, { id: 'signup', title: 'Signup' }, 'auth');
  g = createNode(g, { id: 'billing', title: 'Billing' }, 'app');
  g = createPlan(g, { id: 'p1', name: 'MVP first', createdAt: '2026-01-01T00:00:00Z' });
  g = createPlan(g, { id: 'p2', name: 'Infra first', createdAt: '2026-01-02T00:00:00Z' });
  g = createEpic(g, 'p1', { id: 'e1', title: 'Sprint 1', createdAt: '2026-01-01T00:00:00Z' });
  g = createEpic(g, 'p1', { id: 'e2', title: 'Sprint 2', createdAt: '2026-01-02T00:00:00Z' });
  g = createEpic(g, 'p2', { id: 'e3', title: 'Foundations' });
  return g;
}

describe('ordering helpers', () => {
  it('plans and epics are ordered by creation time', () => {
    const g = fixture();
    assert.deepEqual(plansOrdered(g).map((p) => p.id), ['p1', 'p2']);
    assert.deepEqual(epicsOfPlanOrdered(g, 'p1'), ['e1', 'e2']);
    assert.deepEqual(epicsOfPlanOrdered(g, 'p2'), ['e3']);
  });
});

describe('coveringEpicsInPlan', () => {
  it('reports direct assignments as via-self', () => {
    const g = assignToEpic(fixture(), 'login', 'e1');
    assert.deepEqual(coveringEpicsInPlan(g, 'login', 'p1'), [
      { epicId: 'e1', via: 'login' },
    ]);
  });

  it('inherits coverage from ancestors, scoped to the plan', () => {
    let g = fixture();
    g = assignToEpic(g, 'auth', 'e1');
    g = assignToEpic(g, 'auth', 'e3');
    assert.deepEqual(coveringEpicsInPlan(g, 'login', 'p1'), [
      { epicId: 'e1', via: 'auth' },
    ]);
    assert.deepEqual(coveringEpicsInPlan(g, 'login', 'p2'), [
      { epicId: 'e3', via: 'auth' },
    ]);
    assert.deepEqual(coveringEpicsInPlan(g, 'billing', 'p1'), []);
  });

  it('direct assignment wins over an ancestor for the same epic', () => {
    let g = fixture();
    g = assignToEpic(g, 'auth', 'e1');
    g = assignToEpic(g, 'login', 'e1');
    assert.deepEqual(coveringEpicsInPlan(g, 'login', 'p1'), [
      { epicId: 'e1', via: 'login' },
    ]);
  });

  it('lists distinct epics, direct before inherited', () => {
    let g = fixture();
    g = assignToEpic(g, 'auth', 'e1');
    g = assignToEpic(g, 'login', 'e2');
    assert.deepEqual(coveringEpicsInPlan(g, 'login', 'p1'), [
      { epicId: 'e2', via: 'login' },
      { epicId: 'e1', via: 'auth' },
    ]);
  });
});

describe('overlappingMembers', () => {
  it('flags a member whose descendant sits in another epic of the same plan', () => {
    let g = fixture();
    g = assignToEpic(g, 'auth', 'e1');
    g = assignToEpic(g, 'login', 'e2');
    assert.deepEqual(overlappingMembers(g, 'e1'), ['auth']);
    assert.deepEqual(overlappingMembers(g, 'e2'), []);
  });

  it('ignores assignments in other plans', () => {
    let g = fixture();
    g = assignToEpic(g, 'auth', 'e1');
    g = assignToEpic(g, 'login', 'e3');
    assert.deepEqual(overlappingMembers(g, 'e1'), []);
  });

  it('ignores the member itself being in two epics (only descendants count)', () => {
    let g = fixture();
    g = assignToEpic(g, 'login', 'e1');
    g = assignToEpic(g, 'login', 'e2');
    assert.deepEqual(overlappingMembers(g, 'e1'), []);
    assert.deepEqual(overlappingMembers(g, 'e2'), []);
  });
});
