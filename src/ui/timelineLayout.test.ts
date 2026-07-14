import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGroup,
  emptyGraph,
  setEstimate,
  updateSettings,
} from '../model/graph.ts';
import { buildTimeline } from './timelineLayout.ts';
import type { ProjectGraph } from '../model/types.ts';

function fixture(): ProjectGraph {
  let g = emptyGraph();
  g = updateSettings(g, { startDate: '2024-01-01', targetDate: '2024-01-05' });
  g = createGroup(g, { id: 'block', title: 'Block' });
  g = createGroup(g, { id: 'e1', title: 'Epic 1' }, 'block');
  g = createGroup(g, { id: 'e2', title: 'Epic 2' }, 'block');
  g = setEstimate(g, 'e1', { durationEstimate: 2 }); // Jan1..Jan2
  g = setEstimate(g, 'e2', { durationEstimate: 2 }); // queued Jan3..Jan4
  return g;
}

describe('buildTimeline', () => {
  it('is empty when nothing is scheduled', () => {
    assert.equal(buildTimeline(emptyGraph()).empty, true);
  });

  it('lays out container + unit rows in pre-order with fractions', () => {
    const t = buildTimeline(fixture());
    assert.deepEqual(t.rows.map((r) => r.id), ['block', 'e1', 'e2']);
    assert.equal(t.rangeStart, '2024-01-01');
    assert.equal(t.rangeEnd, '2024-01-05'); // extended to the target date

    const block = t.rows[0]!;
    assert.equal(block.isUnit, false);
    assert.equal(block.depth, 0);
    assert.equal(block.startFrac, 0);
    assert.equal(block.endFrac, 0.75); // Jan1..Jan4 over a 4-day span

    const e1 = t.rows[1]!;
    assert.equal(e1.isUnit, true);
    assert.equal(e1.depth, 1);
    assert.deepEqual([e1.startFrac, e1.endFrac], [0, 0.25]);

    const e2 = t.rows[2]!;
    assert.deepEqual([e2.startFrac, e2.endFrac], [0.5, 0.75]);
  });

  it('emits projected-finish and target markers', () => {
    const t = buildTimeline(fixture());
    const finish = t.markers.find((m) => m.kind === 'finish')!;
    const target = t.markers.find((m) => m.kind === 'target')!;
    assert.equal(finish.date, '2024-01-04');
    assert.equal(finish.frac, 0.75);
    assert.equal(target.date, '2024-01-05');
    assert.equal(target.frac, 1);
  });

  it('places a weekly tick on the first Monday', () => {
    const t = buildTimeline(fixture());
    assert.equal(t.ticks[0]!.label, '1/1'); // 2024-01-01 is a Monday
  });

  it('has no weekend bands when the range has no weekend', () => {
    const t = buildTimeline(fixture()); // Jan1 (Mon) .. Jan5 (Fri)
    assert.deepEqual(t.weekends, []);
  });

  it('merges a Sat+Sun into one weekend band', () => {
    let g = emptyGraph();
    g = updateSettings(g, { startDate: '2024-01-01', targetDate: '2024-01-08' });
    g = createGroup(g, { id: 'u1', title: 'U1' });
    g = setEstimate(g, 'u1', { durationEstimate: 2 });
    const t = buildTimeline(g); // range extends to Jan8 (Mon) via the target
    assert.equal(t.weekends.length, 1);
    assert.equal(t.weekends[0]!.startFrac, 5 / 7); // Jan6 (Sat)
    assert.equal(t.weekends[0]!.endFrac, 1); // through Jan8 (exclusive)
  });
});
