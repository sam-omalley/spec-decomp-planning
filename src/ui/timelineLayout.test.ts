import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGroup,
  emptyGraph,
  setEstimate,
  updateSettings,
} from '../model/graph.ts';
import { buildTimeline, dateAtFrac } from './timelineLayout.ts';
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

  it('emits a planned-start marker at the settings start date (#85)', () => {
    const t = buildTimeline(fixture());
    const start = t.markers.find((m) => m.kind === 'start')!;
    assert.equal(start.date, '2024-01-01');
    assert.equal(start.frac, 0);
  });

  it('emits a now marker, extending the range when now falls outside it (#85)', () => {
    const t = buildTimeline(fixture(), '2023-12-25'); // before the scheduled range
    const now = t.markers.find((m) => m.kind === 'now')!;
    assert.equal(now.date, '2023-12-25');
    assert.equal(t.rangeStart, '2023-12-25');
    assert.equal(now.frac, 0);
  });

  it('dateAtFrac inverts frac back to the calendar date (#85)', () => {
    const t = buildTimeline(fixture()); // Jan1..Jan5, a 4-day span
    assert.equal(dateAtFrac(t, 0), '2024-01-01');
    assert.equal(dateAtFrac(t, 0.5), '2024-01-03');
    assert.equal(dateAtFrac(t, 1), '2024-01-05');
  });

  it('ticks daily for a short range (≤14 days)', () => {
    const t = buildTimeline(fixture()); // Jan1..Jan5, a 4-day span
    assert.deepEqual(
      t.ticks.map((tk) => tk.label),
      ['1/1', '1/2', '1/3', '1/4', '1/5'],
    );
  });

  it('falls back to weekly ticks from the first Monday for a long range', () => {
    let g = emptyGraph();
    g = updateSettings(g, { startDate: '2024-01-01', targetDate: '2024-02-01' }); // 31-day span
    g = createGroup(g, { id: 'u1', title: 'U1' });
    g = setEstimate(g, 'u1', { durationEstimate: 2 });
    const t = buildTimeline(g);
    assert.deepEqual(
      t.ticks.map((tk) => tk.label),
      ['1/1', '1/8', '1/15', '1/22', '1/29'],
    );
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

  it('omits stretchNote when speed/FTE are a 1× no-op (#64)', () => {
    const t = buildTimeline(fixture());
    assert.equal(t.rows[1]!.durationEstimate, 2);
    assert.equal(t.rows[1]!.stretchNote, undefined);
  });

  it('explains a slower-than-estimate span via stretchNote (#64)', () => {
    let g = emptyGraph();
    g = updateSettings(g, { startDate: '2024-01-01', speedMultiplier: 0.8 });
    g = createGroup(g, { id: 'u1', title: 'U1' });
    g = setEstimate(g, 'u1', { durationEstimate: 2 });
    const t = buildTimeline(g);
    assert.equal(t.rows[0]!.stretchNote, '2d estimate ÷ 0.8× speed = 2.5 working days');
  });
});
