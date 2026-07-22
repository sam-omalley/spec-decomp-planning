import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addEdge,
  assignResource,
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
  g = updateSettings(g, { startDate: '2024-01-01', ...overrides });
  return g;
}

/** N full-time tracks, ids r0..r(N-1) — capacity is one track per resource. */
function tracks(n: number, fte = 1) {
  return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `R${i}`, fte, leave: [] }));
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
      trackResourceId: null,
    });
    assert.equal(s.projectFinish, '2024-01-05');
  });

  it('omits `stretch` when speed and FTE are both a no-op (1×)', () => {
    let g = base();
    g = group(g, 'a', 2);
    const s = scheduleProject(g);
    assert.equal(s.groups.get('a')!.stretch, undefined);
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
  it('runs independent units in parallel up to the track count', () => {
    let g = base({ resources: tracks(2) });
    g = group(g, 'a', 3);
    g = group(g, 'b', 3);
    const s = scheduleProject(g);
    assert.equal(s.groups.get('a')!.start, '2024-01-01');
    assert.equal(s.groups.get('b')!.start, '2024-01-01');
  });

  it('queues the third unit when only two tracks exist', () => {
    let g = base({ resources: tracks(2) });
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
    assert.deepEqual(s.groups.get('a')!.stretch, { speedMultiplier: 2, fte: 1 });
  });

  it('reports the stretch that lands a 2-day estimate on the Monday after a weekend (#64)', () => {
    // 2024-01-04 is a Thursday: 2 raw days would finish Fri Jan 5, but at
    // 0.8× speed the working-day span is 2.5 — Thu, Fri, then the weekend
    // is skipped so the finish lands on Mon Jan 8, not the estimate-implied
    // Friday. `stretch` is what a view uses to explain that gap.
    let g = base({ startDate: '2024-01-04', speedMultiplier: 0.8 });
    g = group(g, 'a', 2);
    const s = scheduleProject(g);
    assert.equal(s.groups.get('a')!.start, '2024-01-04');
    assert.equal(s.groups.get('a')!.finish, '2024-01-08');
    assert.deepEqual(s.groups.get('a')!.stretch, { speedMultiplier: 0.8, fte: 1 });
  });
});

describe('scheduleProject — resourcing', () => {
  it('stretches a duration by the assigned resource FTE', () => {
    let g = base({ resources: [{ id: 'r0', name: 'Half', fte: 0.5, leave: [] }] });
    g = group(g, 'a', 2); // 2 / (1 × 0.5) = 4 working days → Mon..Thu
    g = assignResource(g, 'a', 'r0');
    const s = scheduleProject(g);
    assert.equal(s.groups.get('a')!.finish, '2024-01-04');
    assert.deepEqual(s.groups.get('a')!.stretch, { speedMultiplier: 1, fte: 0.5 });
  });

  it('pins assigned units to their resource track, serialising them', () => {
    let g = base({ resources: tracks(2) }); // two free tracks r0, r1
    g = group(g, 'a', 3);
    g = group(g, 'b', 3);
    g = assignResource(g, 'a', 'r0');
    g = assignResource(g, 'b', 'r0'); // both on r0, so b waits for a
    const s = scheduleProject(g);
    assert.equal(s.groups.get('a')!.start, '2024-01-01');
    assert.equal(s.groups.get('b')!.start, '2024-01-04'); // after a, not on idle r1
  });

  it('lets an unassigned unit take the earliest-free track', () => {
    let g = base({ resources: tracks(2) });
    g = group(g, 'a', 3);
    g = assignResource(g, 'a', 'r0');
    g = group(g, 'b', 3); // unassigned → floats to the free r1, runs in parallel
    const s = scheduleProject(g);
    assert.equal(s.groups.get('b')!.start, '2024-01-01');
  });

  it('reports trackResourceId for both a pinned and an auto-placed unit', () => {
    let g = base({ resources: tracks(2) });
    g = group(g, 'a', 3);
    g = assignResource(g, 'a', 'r0');
    g = group(g, 'b', 3); // unassigned → auto-placed on r1
    const s = scheduleProject(g);
    assert.equal(s.groups.get('a')!.trackResourceId, 'r0');
    assert.equal(s.groups.get('b')!.trackResourceId, 'r1');
  });

  it('treats an empty team as one full-time track', () => {
    let g = base(); // no resources
    g = group(g, 'a', 2);
    g = group(g, 'b', 2); // queued behind a on the single track
    const s = scheduleProject(g);
    assert.equal(s.groups.get('a')!.start, '2024-01-01');
    assert.equal(s.groups.get('b')!.start, '2024-01-03');
  });
});

describe('scheduleProject — calendar exceptions (holidays & leave)', () => {
  it('skips a project-wide holiday for a unit with no resource at all', () => {
    let g = base({ holidays: [{ start: '2024-01-02', end: '2024-01-02' }] }); // Tue
    g = group(g, 'a', 2); // 2 working days, would naively be Mon+Tue
    const s = scheduleProject(g);
    assert.equal(s.groups.get('a')!.start, '2024-01-01');
    assert.equal(s.groups.get('a')!.finish, '2024-01-03'); // Tue skipped
  });

  it('is a no-op when the holiday list is empty (default, backward compatible)', () => {
    let g = base();
    g = group(g, 'a', 5);
    const s = scheduleProject(g);
    assert.equal(s.groups.get('a')!.finish, '2024-01-05');
  });

  it("extends a unit's finish past a mid-span leave day on its own resource's track", () => {
    let g = base({
      resources: [{ id: 'r0', name: 'Ada', fte: 1, leave: [{ start: '2024-01-03', end: '2024-01-03' }] }],
    });
    g = group(g, 'a', 3); // naively Mon..Wed
    g = assignResource(g, 'a', 'r0');
    const s = scheduleProject(g);
    assert.equal(s.groups.get('a')!.start, '2024-01-01'); // start unaffected
    assert.equal(s.groups.get('a')!.finish, '2024-01-04'); // Wed skipped, spills to Thu
  });

  it("pushes a unit's start forward when it would otherwise begin on its resource's leave", () => {
    let g = base({
      resources: [{ id: 'r0', name: 'Ada', fte: 1, leave: [{ start: '2024-01-01', end: '2024-01-01' }] }],
    });
    g = group(g, 'a', 1);
    g = assignResource(g, 'a', 'r0');
    const s = scheduleProject(g);
    assert.equal(s.groups.get('a')!.start, '2024-01-02');
    assert.equal(s.groups.get('a')!.finish, '2024-01-02');
  });

  it("only affects the leave-taking resource's own track, not a parallel one", () => {
    let g = base({
      resources: [
        { id: 'r0', name: 'Ada', fte: 1, leave: [{ start: '2024-01-02', end: '2024-01-03' }] },
        { id: 'r1', name: 'Bo', fte: 1, leave: [] },
      ],
    });
    g = group(g, 'a', 3);
    g = assignResource(g, 'a', 'r0');
    g = group(g, 'b', 3);
    g = assignResource(g, 'b', 'r1');
    const s = scheduleProject(g);
    assert.equal(s.groups.get('a')!.finish, '2024-01-05'); // Tue+Wed skipped
    assert.equal(s.groups.get('b')!.finish, '2024-01-03'); // unaffected
  });

  it('never moves an in-progress unit\'s real start, only extends its projected remainder', () => {
    let g = base({
      resources: [{ id: 'r0', name: 'Ada', fte: 1, leave: [{ start: '2024-01-03', end: '2024-01-03' }] }],
    });
    g = group(g, 'a', 4); // 4-day estimate
    g = assignResource(g, 'a', 'r0');
    g = setActualDates(g, 'a', { actualStart: '2024-01-01' }); // in progress
    const s = scheduleProject(g);
    assert.equal(s.groups.get('a')!.start, '2024-01-01'); // unmoved
    // Naive finish (no leave) would be Jan4; the Jan3 leave day pushes it to Jan5.
    assert.equal(s.groups.get('a')!.finish, '2024-01-05');
  });
});

describe('scheduleProject — slack', () => {
  it('gives a parallel non-critical unit slack up to the project finish', () => {
    let g = base({ resources: tracks(2) });
    g = group(g, 'a', 5); // Mon..Fri, defines the project finish
    g = group(g, 'b', 2); // Mon..Tue, idle the rest of the week
    const s = scheduleProject(g);
    assert.equal(s.groups.get('a')!.slackUntil, undefined); // critical, 0 slack
    assert.equal(s.groups.get('b')!.slackUntil, '2024-01-05'); // could slip to Fri
  });

  it('gives every unit on the critical chain zero slack', () => {
    let g = base();
    g = group(g, 'a', 2);
    g = group(g, 'b', 2);
    g = addEdge(g, { type: 'depends_on', from: 'b', to: 'a' });
    const s = scheduleProject(g);
    assert.equal(s.groups.get('a')!.slackUntil, undefined);
    assert.equal(s.groups.get('b')!.slackUntil, undefined);
  });

  it('gives a shorter branch of a diamond slack up to the longer branch', () => {
    // a → b (4 days) → d, and a → c (1 day) → d: c is slack, b is critical.
    let g = base({ resources: tracks(2) });
    g = group(g, 'a', 1);
    g = group(g, 'b', 4);
    g = group(g, 'c', 1);
    g = group(g, 'd', 1);
    g = addEdge(g, { type: 'depends_on', from: 'b', to: 'a' });
    g = addEdge(g, { type: 'depends_on', from: 'c', to: 'a' });
    g = addEdge(g, { type: 'depends_on', from: 'd', to: 'b' });
    g = addEdge(g, { type: 'depends_on', from: 'd', to: 'c' });
    const s = scheduleProject(g);
    assert.equal(s.groups.get('b')!.slackUntil, undefined); // on the critical path
    assert.notEqual(s.groups.get('c')!.slackUntil, undefined); // 3 days of float
  });

  it("treats a shared track's queue as an implicit prereq — no false slack from capacity alone", () => {
    // No dependency edge between a and b, but a single track (no team) means
    // b is queued behind a. Delaying a would delay b, so a must show zero
    // slack even though nothing *depends* on it.
    let g = base(); // empty team ⇒ one full-time track
    g = group(g, 'a', 2); // Mon..Tue
    g = group(g, 'b', 2); // queued: Wed..Thu, defines the project finish
    const s = scheduleProject(g);
    assert.equal(s.groups.get('a')!.slackUntil, undefined);
    assert.equal(s.groups.get('b')!.slackUntil, undefined);
  });

  it('never reports slack for a done unit — nothing left to flex', () => {
    let g = base({ resources: tracks(2) });
    g = group(g, 'a', 5);
    g = group(g, 'b', 1);
    g = setActualDates(g, 'b', { actualStart: '2024-01-01', actualFinish: '2024-01-01' });
    const s = scheduleProject(g);
    assert.equal(s.groups.get('b')!.source, 'actual');
    assert.equal(s.groups.get('b')!.slackUntil, undefined);
  });

  it('does not hang on a dependency cycle', () => {
    let g = base();
    g = group(g, 'a', 1);
    g = group(g, 'b', 1);
    g = addEdge(g, { type: 'depends_on', from: 'a', to: 'b' });
    g = addEdge(g, { type: 'depends_on', from: 'b', to: 'a' });
    const s = scheduleProject(g); // must return, not loop forever
    assert.ok(s.groups.get('a'));
    assert.ok(s.groups.get('b'));
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
    let g = base();
    g = group(g, 'block', null);
    g = group(g, 'e1', 2, 'block'); // Jan1..Jan2
    g = group(g, 'e2', 2, 'block'); // queued: Jan3..Jan4
    const s = scheduleProject(g);
    const block = s.groups.get('block')!;
    assert.equal(block.isUnit, false);
    assert.equal(block.start, '2024-01-01');
    assert.equal(block.finish, '2024-01-04');
  });

  it('does not hang when a dependency endpoint sits above a residual contains cycle (#128)', () => {
    let g = base();
    g = group(g, 'd', 1); // a real scheduling unit, reachable from a root
    // Two containers that only reference each other — orphaned (not in
    // groupRootOrder), so schedulingUnits' root-driven walk never visits
    // them. This isolates the test to enclosingUnit's own parent walk,
    // which the dependency-adjacency scan below reaches directly regardless
    // of root reachability.
    g = createGroup(g, { id: 'c1', title: 'c1' });
    g = createGroup(g, { id: 'c2', title: 'c2' });
    g = { ...g, groupRootOrder: g.groupRootOrder.filter((id) => id !== 'c1' && id !== 'c2') };
    // Simulate corruption that skipped graph.ts's cycle guard: two
    // 'contains' edges pointing at each other, bypassing addEdge.
    g = {
      ...g,
      edges: {
        ...g.edges,
        bad1: { id: 'bad1', type: 'contains', from: 'c1', to: 'c2', order: 0 },
        bad2: { id: 'bad2', type: 'contains', from: 'c2', to: 'c1', order: 0 },
      },
    };
    g = addEdge(g, { type: 'depends_on', from: 'c1', to: 'd' });
    const s = scheduleProject(g); // must return, not spin walking the cycle
    assert.ok(s.groups.get('d'));
  });
});

describe('scheduleProject — actuals blend over projection', () => {
  it('uses real dates for a done unit and projects dependents from its finish', () => {
    let g = base({ speedMultiplier: 0.8 }); // even with a stretch factor set...
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
      trackResourceId: null,
      // ...a done unit has real dates, nothing projected, so no stretch to explain.
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

describe('scheduleProject — critical path', () => {
  it('is the chain of binding prerequisites to the last finish', () => {
    let g = base(); // 1 track
    g = group(g, 'a', 5);
    g = group(g, 'b', 2);
    g = group(g, 'c', 1);
    g = addEdge(g, { type: 'depends_on', from: 'b', to: 'a' });
    g = addEdge(g, { type: 'depends_on', from: 'c', to: 'b' });
    assert.deepEqual(scheduleProject(g).criticalPath, ['a', 'b', 'c']);
  });

  it('follows the longer of two parallel dependency chains', () => {
    let g = base({ resources: tracks(2) });
    g = group(g, 'a', 2);
    g = group(g, 'b', 2); // short chain a→b
    g = group(g, 'c', 3);
    g = group(g, 'd', 3); // long chain c→d
    g = addEdge(g, { type: 'depends_on', from: 'b', to: 'a' });
    g = addEdge(g, { type: 'depends_on', from: 'd', to: 'c' });
    // d finishes last; its chain c→d is critical, a/b are not.
    assert.deepEqual(scheduleProject(g).criticalPath, ['c', 'd']);
  });

  it('is just the final unit when nothing gates it (capacity-bound)', () => {
    let g = base({ resources: tracks(3) });
    g = group(g, 'a', 4);
    g = group(g, 'b', 2);
    // No dependencies: a finishes last, gated by nothing.
    assert.deepEqual(scheduleProject(g).criticalPath, ['a']);
  });
});

describe('scheduleProject — dependency lag/lead and start-to-start (#132)', () => {
  it('pushes a dependent start N working days past its prerequisite finish (FS + lag)', () => {
    // Two tracks so capacity never binds — isolates the pure dependency
    // offset. 'a' (dependency-free) is scheduled first and takes track 0;
    // 'b' is then the only ready unit and lands on the free track 1.
    let g = base({ resources: tracks(2) });
    g = group(g, 'a', 2); // Jan1..Jan2 (offsets 0..2)
    g = group(g, 'b', 1);
    g = addEdge(g, { type: 'depends_on', from: 'b', to: 'a', lagDays: 3 });
    const s = scheduleProject(g);
    // finish offset 2 + 3 lag = offset 5 = Jan8 (see the offset map above).
    assert.equal(s.groups.get('b')!.start, '2024-01-08');
  });

  it('lets a dependent start before its prerequisite finishes (FS + negative lag = lead)', () => {
    let g = base({ resources: tracks(2) });
    g = group(g, 'a', 2); // Jan1..Jan2
    g = group(g, 'b', 1);
    g = addEdge(g, { type: 'depends_on', from: 'b', to: 'a', lagDays: -1 });
    const s = scheduleProject(g);
    // finish offset 2 - 1 lead = offset 1 = Jan2 — overlaps 'a's own finish.
    assert.equal(s.groups.get('b')!.start, '2024-01-02');
  });

  it('runs a start-to-start dependent alongside its prerequisite with no lag', () => {
    let g = base({ resources: tracks(2) });
    g = group(g, 'a', 3);
    g = group(g, 'b', 1);
    g = addEdge(g, { type: 'depends_on', from: 'b', to: 'a', depKind: 'SS' });
    const s = scheduleProject(g);
    assert.equal(s.groups.get('b')!.start, s.groups.get('a')!.start);
  });

  it("runs a start-to-start dependent N days behind its prerequisite's start", () => {
    let g = base({ resources: tracks(2) });
    g = group(g, 'a', 5);
    g = group(g, 'b', 1);
    g = addEdge(g, { type: 'depends_on', from: 'b', to: 'a', depKind: 'SS', lagDays: 1 });
    const s = scheduleProject(g);
    // a starts offset 0 (Jan1); b's SS+1 constraint = offset 1 = Jan2.
    assert.equal(s.groups.get('b')!.start, '2024-01-02');
  });

  it('extends the critical path distance by the lag on a binding FS edge', () => {
    let g = base(); // 1 track
    g = group(g, 'a', 2);
    g = group(g, 'b', 1);
    g = addEdge(g, { type: 'depends_on', from: 'b', to: 'a', lagDays: 4 });
    const s = scheduleProject(g);
    assert.deepEqual(s.criticalPath, ['a', 'b']);
    // Without the lag, b would start right after a (offset 2); the lag
    // pushes the project finish out by those same 4 working days.
    const noLag = scheduleProject(group(group(base(), 'a', 2), 'b', 1));
    assert.ok(s.groups.get('b')!.finish > noLag.groups.get('b')!.finish);
  });

  it('still reports correct slack for a parallel unit when the other chain has lag', () => {
    let g = base({ resources: tracks(2) });
    g = group(g, 'a', 2); // track 0, Jan1..Jan2
    g = group(g, 'b', 2); // track 1, Jan1..Jan2, parallel — no dependents
    g = group(g, 'c', 1); // depends on a, with a 3-day lag after a's finish
    g = addEdge(g, { type: 'depends_on', from: 'c', to: 'a', lagDays: 3 });
    const s = scheduleProject(g);
    // c is the critical path's tail; b has no downstream dependents, so it
    // can slip all the way up to the project finish.
    assert.equal(s.groups.get('b')!.slackUntil, s.projectFinish);
    assert.equal(s.groups.get('c')!.slackUntil, undefined); // on the critical path
  });
});

describe('scheduleProject — durationOverrides (#133)', () => {
  it('uses the override instead of the node estimate when present', () => {
    let g = base();
    g = group(g, 'a', 5); // Mon..Fri by default
    const s = scheduleProject(g, undefined, new Map([['a', 2]])); // Mon..Tue instead
    assert.equal(s.groups.get('a')!.finish, '2024-01-02');
  });

  it('falls back to the node estimate for a unit with no entry in the map', () => {
    let g = base();
    g = group(g, 'a', 5);
    const s = scheduleProject(g, undefined, new Map([['other', 99]]));
    assert.equal(s.groups.get('a')!.finish, '2024-01-05');
  });

  it('an empty map reproduces the deterministic schedule exactly', () => {
    let g = base({ resources: tracks(2) });
    g = group(g, 'a', 3);
    g = group(g, 'b', 2);
    g = addEdge(g, { type: 'depends_on', from: 'b', to: 'a', lagDays: 1 });
    assert.deepEqual(scheduleProject(g, undefined, new Map()), scheduleProject(g));
  });
});
