import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addEdge,
  addResource,
  assignResource,
  createGroup,
  emptyGraph,
  setActualDates,
  setEstimate,
  updateNode,
  updateSettings,
} from './graph.ts';
import {
  analyzeConcerns,
  filterConcernsBySeverity,
  type Concern,
  type ConcernKind,
  type Severity,
} from './concerns.ts';
import type { ProjectGraph } from './types.ts';

function base(overrides: Partial<Parameters<typeof updateSettings>[1]> = {}): ProjectGraph {
  return updateSettings(emptyGraph(), { startDate: '2024-01-01', ...overrides });
}
function group(g: ProjectGraph, id: string, days: number | null, parent?: string): ProjectGraph {
  g = createGroup(g, { id, title: id }, parent);
  if (days !== null) g = setEstimate(g, id, { durationEstimate: days });
  return g;
}
function kinds(g: ProjectGraph, now?: string): ConcernKind[] {
  return analyzeConcerns(g, now).map((c) => c.kind);
}

describe('analyzeConcerns — per-unit signals', () => {
  it('flags an in-progress unit past its projected finish', () => {
    let g = base();
    g = group(g, 'a', 3); // Mon..Wed if started Jan 1
    g = setActualDates(g, 'a', { actualStart: '2024-01-01' }); // in progress
    // now is well past the projected finish (Jan 3).
    const c = analyzeConcerns(g, '2024-01-10').find((x) => x.kind === 'overdue');
    assert.ok(c, 'expected an overdue concern');
    assert.equal(c!.id, 'a');
    assert.equal(c!.severity, 'high');
  });

  it('does not flag an in-progress unit that is still on time', () => {
    let g = base();
    g = group(g, 'a', 10);
    g = setActualDates(g, 'a', { actualStart: '2024-01-01' });
    assert.equal(kinds(g, '2024-01-02').includes('overdue'), false);
  });

  it('does not flag a done unit as overdue', () => {
    let g = base();
    g = group(g, 'a', 3);
    g = setActualDates(g, 'a', { actualStart: '2024-01-01', actualFinish: '2024-01-03' });
    assert.equal(kinds(g, '2024-01-30').includes('overdue'), false);
  });

  it('flags a blocked group', () => {
    let g = base();
    g = group(g, 'a', 3);
    g = updateNode(g, 'a', { status: 'blocked' });
    const c = analyzeConcerns(g).find((x) => x.kind === 'blocked');
    assert.ok(c);
    assert.equal(c!.id, 'a');
  });

  it('flags units in a dependency cycle', () => {
    let g = base();
    g = group(g, 'a', 1);
    g = group(g, 'b', 1);
    g = addEdge(g, { type: 'depends_on', from: 'a', to: 'b' });
    g = addEdge(g, { type: 'depends_on', from: 'b', to: 'a' });
    const cyc = analyzeConcerns(g).filter((x) => x.kind === 'cycle');
    assert.equal(cyc.length, 2);
  });

  it('flags a leaf group with no estimate as unestimated', () => {
    let g = base();
    g = group(g, 'block', null); // container — has a child, not a leaf
    g = group(g, 'leaf', null, 'block'); // leaf, no estimate → gap
    const un = analyzeConcerns(g).filter((x) => x.kind === 'unestimated');
    assert.deepEqual(
      un.map((x) => x.id),
      ['leaf'],
    );
  });

  it('never flags a parked group or its subtree (#155)', () => {
    let g = base();
    g = group(g, 'block', null); // container, parked
    g = updateNode(g, 'block', { parkingLot: true, status: 'blocked' });
    g = group(g, 'leaf', null, 'block'); // unestimated leaf, inside the parked subtree
    const ks = kinds(g);
    assert.equal(ks.includes('blocked'), false);
    assert.equal(ks.includes('unestimated'), false);
  });
});

describe('analyzeConcerns — resourcing', () => {
  it('flags an unassigned, not-started unit as low severity, only when a team exists', () => {
    let g = base();
    g = group(g, 'a', 3);
    // No team yet → no unassigned concern (everything is unassigned; noise).
    assert.equal(kinds(g).includes('unassigned'), false);

    g = addResource(g, { id: 'r1', name: 'Ada', fte: 1 });
    const c = analyzeConcerns(g).find((x) => x.kind === 'unassigned');
    assert.ok(c);
    assert.equal(c!.severity, 'low');

    g = assignResource(g, 'a', 'r1');
    assert.equal(kinds(g).includes('unassigned'), false);
  });

  it('flags an unassigned, in-progress unit as medium severity', () => {
    let g = base();
    g = group(g, 'a', 3);
    g = addResource(g, { id: 'r1', name: 'Ada', fte: 1 });
    g = setActualDates(g, 'a', { actualStart: '2024-01-01' });
    const c = analyzeConcerns(g).find((x) => x.kind === 'unassigned');
    assert.ok(c);
    assert.equal(c!.severity, 'medium');
  });

  it('flags an unassigned, done unit as medium severity', () => {
    let g = base();
    g = group(g, 'a', 3);
    g = addResource(g, { id: 'r1', name: 'Ada', fte: 1 });
    g = setActualDates(g, 'a', { actualStart: '2024-01-01', actualFinish: '2024-01-03' });
    const c = analyzeConcerns(g).find((x) => x.kind === 'unassigned');
    assert.ok(c);
    assert.equal(c!.severity, 'medium');
  });
});

describe('analyzeConcerns — project-level signals', () => {
  it('flags thin WIP when work waits below capacity', () => {
    let g = base({
      resources: [
        { id: 'r1', name: 'A', fte: 1, leave: [] },
        { id: 'r2', name: 'B', fte: 1, leave: [] },
      ],
    });
    g = group(g, 'a', 3); // not started
    g = group(g, 'b', 3); // not started → 0 in progress vs capacity 2
    const c = analyzeConcerns(g).find((x) => x.kind === 'thin_wip');
    assert.ok(c);
    assert.equal(c!.id, null);
  });

  it('does not flag thin WIP once enough is in progress', () => {
    let g = base(); // capacity 1 (empty team)
    g = group(g, 'a', 3);
    g = setActualDates(g, 'a', { actualStart: '2024-01-01' }); // 1 in progress
    assert.equal(kinds(g).includes('thin_wip'), false);
  });

  it('flags a projection past the target date', () => {
    let g = base({ targetDate: '2024-01-03' });
    g = group(g, 'a', 10); // finishes well past Jan 3
    const c = analyzeConcerns(g).find((x) => x.kind === 'past_target');
    assert.ok(c);
    assert.equal(c!.severity, 'high');
  });

  it('is empty for a clean, on-track plan', () => {
    let g = base({ targetDate: '2024-12-31', resources: [{ id: 'r1', name: 'A', fte: 1, leave: [] }] });
    g = group(g, 'a', 3);
    g = assignResource(g, 'a', 'r1');
    g = setActualDates(g, 'a', { actualStart: '2024-01-01' }); // in progress, on time
    assert.deepEqual(analyzeConcerns(g, '2024-01-01'), []);
  });

  it('sorts high-severity concerns first', () => {
    let g = base({ targetDate: '2024-01-02' });
    g = group(g, 'a', 10);
    g = updateNode(g, 'a', { status: 'blocked' }); // medium
    const list = analyzeConcerns(g, '2024-01-01');
    assert.equal(list[0]!.severity, 'high'); // past_target sorts above blocked
  });
});

describe('filterConcernsBySeverity', () => {
  const mk = (severity: Severity): Concern => ({
    kind: 'blocked',
    severity,
    id: severity,
    title: severity,
    detail: '',
  });
  const list: Concern[] = [mk('high'), mk('medium'), mk('low'), mk('high')];

  it('keeps only active severities, preserving order', () => {
    const out = filterConcernsBySeverity(list, new Set<Severity>(['high', 'medium']));
    assert.deepEqual(out.map((c) => c.severity), ['high', 'medium', 'high']);
  });

  it('returns nothing for an empty active set', () => {
    assert.deepEqual(filterConcernsBySeverity(list, new Set()), []);
  });

  it('returns everything when all severities are active', () => {
    const all = new Set<Severity>(['high', 'medium', 'low']);
    assert.equal(filterConcernsBySeverity(list, all).length, list.length);
  });
});
