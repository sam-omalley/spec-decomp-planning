import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createNode,
  emptyGraph,
  setActualDates,
  setEstimate,
} from './graph.ts';
import { rolledActuals, rolledDuration, rolledEffort } from './rollup.ts';
import type { ProjectGraph } from './types.ts';

/** parent ─┬─ a
 *          └─ b ─── b1 */
function tree(): ProjectGraph {
  let g = emptyGraph();
  g = createNode(g, { id: 'parent', title: 'Parent', type: 'feature' });
  g = createNode(g, { id: 'a', title: 'A' }, 'parent');
  g = createNode(g, { id: 'b', title: 'B' }, 'parent');
  g = createNode(g, { id: 'b1', title: 'B1' }, 'b');
  return g;
}

describe('rolledDuration / rolledEffort', () => {
  it('sums estimated leaves and flags unestimated ones as gaps', () => {
    let g = tree();
    g = setEstimate(g, 'a', { durationEstimate: 2 });
    g = setEstimate(g, 'b1', { durationEstimate: 3 });
    // 'b' has no own estimate, so it rolls up from b1.
    const b = rolledDuration(g, 'b');
    assert.deepEqual(b, { value: 3, fromOwn: false, hasGaps: false });
    // 'parent' = a(2) + b1(3); nothing unestimated ⇒ no gaps.
    assert.deepEqual(rolledDuration(g, 'parent'), {
      value: 5,
      fromOwn: false,
      hasGaps: false,
    });
  });

  it('marks a subtree with an unestimated leaf as having gaps', () => {
    let g = tree();
    g = setEstimate(g, 'a', { durationEstimate: 2 });
    // b1 left unestimated.
    const parent = rolledDuration(g, 'parent');
    assert.equal(parent.value, 2); // only a contributes
    assert.equal(parent.hasGaps, true);
  });

  it("uses a node's own estimate and does not descend (own wins)", () => {
    let g = tree();
    g = setEstimate(g, 'b', { durationEstimate: 10 });
    g = setEstimate(g, 'b1', { durationEstimate: 3 }); // ignored: b owns
    assert.deepEqual(rolledDuration(g, 'b'), {
      value: 10,
      fromOwn: true,
      hasGaps: false,
    });
    // parent sees b as a single 10-day unit, not 3.
    assert.equal(rolledDuration(g, 'parent').value, 10);
  });

  it('returns null for a wholly unestimated subtree', () => {
    const g = tree();
    assert.deepEqual(rolledEffort(g, 'parent'), {
      value: null,
      fromOwn: false,
      hasGaps: true,
    });
  });

  it('rolls the two axes independently', () => {
    let g = tree();
    g = setEstimate(g, 'a', { effort: 5, durationEstimate: 2 });
    g = setEstimate(g, 'b1', { effort: 8 });
    assert.equal(rolledEffort(g, 'parent').value, 13);
    assert.equal(rolledDuration(g, 'parent').value, 2); // b1 has no duration
    assert.equal(rolledDuration(g, 'parent').hasGaps, true);
  });
});

describe('rolledActuals', () => {
  it('aggregates the earliest start and latest finish of the subtree', () => {
    let g = tree();
    g = setActualDates(g, 'a', { actualStart: '2026-07-01', actualFinish: '2026-07-04' });
    g = setActualDates(g, 'b1', { actualStart: '2026-07-03', actualFinish: '2026-07-09' });
    const parent = rolledActuals(g, 'parent');
    assert.equal(parent.start, '2026-07-01');
    assert.equal(parent.finish, '2026-07-09');
    assert.equal(parent.allDone, true);
  });

  it('is not allDone while a unit remains unfinished', () => {
    let g = tree();
    g = setActualDates(g, 'a', { actualStart: '2026-07-01', actualFinish: '2026-07-04' });
    g = setActualDates(g, 'b1', { actualStart: '2026-07-03' }); // started, not finished
    const parent = rolledActuals(g, 'parent');
    assert.equal(parent.start, '2026-07-01');
    assert.equal(parent.finish, '2026-07-04'); // latest finish seen so far
    assert.equal(parent.allDone, false);
  });

  it('reads a unit (own estimate) actuals without descending', () => {
    let g = tree();
    g = setEstimate(g, 'b', { durationEstimate: 5 });
    g = setActualDates(g, 'b', { actualStart: '2026-07-02', actualFinish: '2026-07-08' });
    g = setActualDates(g, 'b1', { actualStart: '2026-01-01' }); // ignored: b is the unit
    assert.deepEqual(rolledActuals(g, 'b'), {
      start: '2026-07-02',
      finish: '2026-07-08',
      allDone: true,
    });
  });
});
