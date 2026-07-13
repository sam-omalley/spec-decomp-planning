import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addEdge,
  createGroup,
  emptyGraph,
  setActualDates,
  setEstimate,
  updateSettings,
} from './graph.ts';
import { scheduleProject, schedulingUnits } from './schedule.ts';
import type { ProjectGraph } from './types.ts';

// 2024-01-01 is a Monday, so working-day offset i maps to a known date:
// 0=Jan1 Mon, 1=Jan2, 2=Jan3, 3=Jan4, 4=Jan5 Fri, 5=Jan8 Mon, 6=Jan9…
function base(overrides: Partial<Parameters<typeof updateSettings>[1]> = {}): ProjectGraph {
  let g = emptyGraph();
  g = updateSettings(g, { startDate: '2024-01-01', parallelTracks: 1, ...overrides });
  return g;
}

function group(g: ProjectGraph, id: string, days: number | null, parent?: string): ProjectGraph {
  g = createGroup(g, { id, title: id }, parent);
  if (days !== null) g = setEstimate(g, id, { durationEstimate: days });
  return g;
}

describe('schedulingUnits', () => {
  it('picks the topmost group with an own estimate and stops descending', () => {
    let g = base();
    g = group(g, 'block', null); // container, no own estimate
    g = group(g, 'epic', 5, 'block'); // unit
    g = group(g, 'story', 2, 'epic'); // absorbed by epic
    assert.deepEqual(schedulingUnits(g), ['epic']);
  });

  it('descends into estimate-less containers to find units', () => {
    let g = base();
    g = group(g, 'block', null);
    g = group(g, 'e1', 3, 'block');
    g = group(g, 'e2', 3, 'block');
    assert.deepEqual(schedulingUnits(g).sort(), ['e1', 'e2']);
  });
});

describe('scheduleProject — calendar & weekends', () => {
  it('places a single unit and skips weekends for its span', () => {
    let g = base();
    g = group(g, 'a', 5); // Mon..Fri
    const s = scheduleProject(g);
    assert.deepEqual(s.groups.get('a'), {
      start: '2024-01-01',
      finish: '2024-01-05',
      source: 'planned',
      isUnit: true,
    });
    assert.equal(s.projectFinish, '2024-01-05');
  });

  it('starts a dependent after its prerequisite, across the weekend', () => {
    let g = base();
    g = group(g, 'a', 5); // finishes Fri Jan 5 (offset 5)
    g = group(g, 'b', 1);
    g = addEdge(g, { type: 'depends_on', from: 'b', to: 'a' }); // b needs a
    const s = scheduleProject(g);
    assert.equal(s.groups.get('b')!.start, '2024-01-08'); // Mon, weekend skipped
    assert.equal(s.groups.get('b')!.finish, '2024-01-08');
  });
});

describe('scheduleProject — capacity', () => {
  it('runs independent units in parallel up to parallelTracks', () => {
    let g = base({ parallelTracks: 2 });
    g = group(g, 'a', 3);
    g = group(g, 'b', 3);
    const s = scheduleProject(g);
    assert.equal(s.groups.get('a')!.start, '2024-01-01');
    assert.equal(s.groups.get('b')!.start, '2024-01-01');
  });

  it('queues the third unit when only two tracks exist', () => {
    let g = base({ parallelTracks: 2 });
    g = group(g, 'a', 3); // offset 0..3
    g = group(g, 'b', 3); // offset 0..3
    g = group(g, 'c', 1);
    const s = scheduleProject(g);
    // a,b fill both tracks (free at offset 3); c takes the earliest, offset 3 = Jan 4.
    assert.equal(s.groups.get('c')!.start, '2024-01-04');
  });

  it('applies the speed multiplier to durations', () => {
    let g = base({ speedMultiplier: 2 });
    g = group(g, 'a', 4); // 4 / 2 = 2 working days → Mon..Tue
    const s = scheduleProject(g);
    assert.equal(s.groups.get('a')!.finish, '2024-01-02');
  });
});

describe('scheduleProject — cycles & containers', () => {
  it('schedules a dependency cycle as a batch without hanging', () => {
    let g = base();
    g = group(g, 'a', 1);
    g = group(g, 'b', 1);
    g = addEdge(g, { type: 'depends_on', from: 'a', to: 'b' });
    g = addEdge(g, { type: 'depends_on', from: 'b', to: 'a' });
    const s = scheduleProject(g);
    // Both get scheduled (sibling order breaks the tie); no infinite loop.
    assert.ok(s.groups.get('a'));
    assert.ok(s.groups.get('b'));
    assert.equal(s.projectFinish, s.groups.get('b')!.finish);
  });

  it('spans a container group over its child units', () => {
    let g = base({ parallelTracks: 1 });
    g = group(g, 'block', null);
    g = group(g, 'e1', 2, 'block'); // Jan1..Jan2
    g = group(g, 'e2', 2, 'block'); // queued: Jan3..Jan4
    const s = scheduleProject(g);
    const block = s.groups.get('block')!;
    assert.equal(block.isUnit, false);
    assert.equal(block.start, '2024-01-01');
    assert.equal(block.finish, '2024-01-04');
  });
});

describe('scheduleProject — actuals blend over projection', () => {
  it('uses real dates for a done unit and projects dependents from its finish', () => {
    let g = base();
    g = group(g, 'a', 5);
    g = group(g, 'b', 1);
    g = addEdge(g, { type: 'depends_on', from: 'b', to: 'a' });
    // a actually finished early, on Wed Jan 3.
    g = setActualDates(g, 'a', { actualStart: '2024-01-01', actualFinish: '2024-01-03' });
    const s = scheduleProject(g);
    assert.deepEqual(s.groups.get('a'), {
      start: '2024-01-01',
      finish: '2024-01-03',
      source: 'actual',
      isUnit: true,
    });
    // b projects from a's actual finish (offset 2 → next is Jan 4).
    assert.equal(s.groups.get('b')!.start, '2024-01-04');
  });

  it('anchors an in-progress unit on its real start and projects the rest', () => {
    let g = base();
    g = group(g, 'a', 3);
    g = setActualDates(g, 'a', { actualStart: '2024-01-02' }); // started Tue, no finish
    const s = scheduleProject(g);
    const a = s.groups.get('a')!;
    assert.equal(a.start, '2024-01-02');
    assert.equal(a.source, 'planned'); // finish still projected
    assert.equal(a.finish, '2024-01-04'); // Tue + 3 working days span → Thu
  });
});

describe('scheduleProject — projections never date work in the past (#19)', () => {
  it('starts not-started work at `now`, not the (past) startDate', () => {
    // startDate is Jan 1 but today is Jan 15 — the project is already
    // running. A not-started unit must project from today, not from the
    // stale start (which understated the finish).
    let g = base();
    g = group(g, 'a', 5);
    const s = scheduleProject(g, '2024-01-15'); // Mon Jan 15
    assert.equal(s.groups.get('a')!.start, '2024-01-15');
    assert.equal(s.groups.get('a')!.finish, '2024-01-19'); // Mon..Fri
  });

  it('still starts after a prerequisite that finishes past `now`', () => {
    // a is done, finishing Fri Jan 5 — later than now (Jan 3). b (not
    // started) must wait on a's finish, not jump to now.
    let g = base();
    g = group(g, 'a', 5);
    g = group(g, 'b', 2);
    g = addEdge(g, { type: 'depends_on', from: 'b', to: 'a' });
    g = setActualDates(g, 'a', { actualStart: '2024-01-01', actualFinish: '2024-01-05' });
    const s = scheduleProject(g, '2024-01-03');
    assert.equal(s.groups.get('b')!.start, '2024-01-08'); // Mon after a's finish
  });

  it('defaults `now` to startDate — no clamp, backward compatible', () => {
    let g = base();
    g = group(g, 'a', 5);
    const s = scheduleProject(g); // no `now` → anchored at startDate
    assert.equal(s.groups.get('a')!.start, '2024-01-01');
  });
});
