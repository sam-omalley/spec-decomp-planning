import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  contactStatuses,
  daysBetween,
  forumStatuses,
  itemNags,
  lastContactWith,
} from './recency.ts';
import {
  addForum,
  addItem,
  addPerson,
  emptyWorkspace,
  logInteraction,
  updateItem,
  updatePerson,
} from './workspace.ts';
import type { Workspace } from './types.ts';

const TODAY = '2026-08-01';

/** Pins createdAt so age-based signals are deterministic (the mutations
 *  stamp "now" by design — ids come from callers, clocks don't). */
function backdate(ws: Workspace, createdAt: string): Workspace {
  const items: Workspace['items'] = {};
  for (const [id, item] of Object.entries(ws.items)) {
    items[id] = { ...item, createdAt, modifiedAt: createdAt };
  }
  return {
    ...ws,
    items,
    people: ws.people.map((p) => ({ ...p, createdAt })),
    forums: ws.forums.map((f) => ({ ...f, createdAt })),
  };
}

function seeded(): Workspace {
  let ws = emptyWorkspace();
  ws = addPerson(ws, { id: 'pm', name: 'Pat', role: 'PM' });
  ws = addPerson(ws, { id: 'lead', name: 'Lee', role: 'My lead' });
  ws = addPerson(ws, { id: 'ict', name: 'Kim', role: 'ICT rep' });
  // Weekly 1-1 with the lead; fortnightly delivery sync with the PM.
  ws = addForum(ws, { id: 'oneone', name: '1-1', cadenceDays: 7, attendees: ['lead'], anchorDate: '2026-07-01' });
  ws = addForum(ws, { id: 'sync', name: 'Sync', cadenceDays: 14, attendees: ['pm', 'lead'], anchorDate: '2026-07-01' });
  return backdate(ws, '2026-07-01T09:00:00Z');
}

describe('date helpers', () => {
  it('counts whole calendar days, signed', () => {
    assert.equal(daysBetween('2026-08-01', '2026-08-15'), 14);
    assert.equal(daysBetween('2026-08-15', '2026-08-01'), -14);
    assert.equal(daysBetween('2026-08-01T18:00', '2026-08-02'), 1, 'date part only');
  });

  it('shifts dates across month ends', () => {
    assert.equal(addDays('2026-07-25', 14), '2026-08-08');
    assert.equal(addDays('2026-08-01', -1), '2026-07-31');
  });
});

describe('contact recency', () => {
  it('takes the tightest cadence across the forums a person sits in', () => {
    const statuses = contactStatuses(seeded(), TODAY);
    const lead = statuses.find((s) => s.personId === 'lead')!;
    assert.equal(lead.cadenceDays, 7, 'weekly 1-1 beats the fortnightly sync');
    assert.equal(lead.forumId, 'oneone');
  });

  it('gives a person in no forum no expectation at all', () => {
    const ict = contactStatuses(seeded(), TODAY).find((s) => s.personId === 'ict')!;
    assert.equal(ict.cadenceDays, null);
    assert.equal(ict.dueAt, null);
    assert.equal(ict.severity, 'ok', 'no forum, no nag');
  });

  it('counts from the last logged contact', () => {
    let ws = seeded();
    ws = logInteraction(ws, { id: 'l1', at: '2026-07-28', forumId: 'oneone', participants: ['lead'] });
    const lead = contactStatuses(ws, TODAY).find((s) => s.personId === 'lead')!;
    assert.equal(lead.lastContactAt, '2026-07-28');
    assert.equal(lead.dueAt, '2026-08-04');
    assert.equal(lead.overdueDays, 0);
    assert.equal(lead.severity, 'ok', 'three days out on a weekly cadence is not "soon"');
  });

  it('warns as the cadence comes round', () => {
    let ws = seeded();
    ws = logInteraction(ws, { id: 'l1', at: '2026-07-30', forumId: 'oneone', participants: ['lead'] });
    const lead = contactStatuses(ws, TODAY).find((s) => s.personId === 'lead')!;
    assert.equal(lead.dueAt, '2026-08-06');
    assert.equal(lead.severity, 'ok');
    const later = contactStatuses(ws, '2026-08-04').find((s) => s.personId === 'lead')!;
    assert.equal(later.severity, 'due_soon', 'two days out on a weekly cadence');
  });

  it('escalates once a whole cycle has been missed', () => {
    // Never contacted, anchored 2026-07-01: 31 days on a weekly cadence.
    const lead = contactStatuses(seeded(), TODAY).find((s) => s.personId === 'lead')!;
    assert.equal(lead.dueAt, '2026-07-08');
    assert.equal(lead.overdueDays, 24);
    assert.equal(lead.severity, 'badly_overdue');
  });

  it('anchors a brand-new forum so it is not instantly overdue', () => {
    let ws = emptyWorkspace();
    ws = addPerson(ws, { id: 'p', name: 'New person' });
    ws = addForum(ws, { id: 'f', name: 'New forum', cadenceDays: 14, attendees: ['p'], anchorDate: TODAY });
    const status = contactStatuses(ws, TODAY)[0]!;
    assert.equal(status.overdueDays, 0);
    assert.equal(status.severity, 'ok');
  });

  it('goes quiet while someone is away, without hiding them', () => {
    let ws = seeded();
    ws = updatePerson(ws, 'lead', { away: [{ start: '2026-07-20', end: '2026-08-10' }] });
    const lead = contactStatuses(ws, TODAY).find((s) => s.personId === 'lead')!;
    assert.equal(lead.away, true);
    assert.equal(lead.severity, 'ok', 'no nagging someone on leave');
    assert.ok(lead.overdueDays > 0, 'but the overdue count is still visible');
  });

  it('leaves archived people out entirely', () => {
    let ws = seeded();
    ws = updatePerson(ws, 'lead', { archivedAt: '2026-07-20T00:00:00Z' });
    assert.equal(
      contactStatuses(ws, TODAY).some((s) => s.personId === 'lead'),
      false,
    );
  });

  it('sorts worst first', () => {
    let ws = seeded();
    ws = logInteraction(ws, { id: 'l1', at: '2026-07-31', forumId: 'sync', participants: ['pm'] });
    const order = contactStatuses(ws, TODAY).map((s) => s.personId);
    assert.equal(order[0], 'lead', 'the badly overdue 1-1 leads');
  });

  it('reports the last contact with a person across any forum', () => {
    let ws = seeded();
    ws = logInteraction(ws, { id: 'l1', at: '2026-07-10', forumId: 'oneone', participants: ['lead'] });
    ws = logInteraction(ws, { id: 'l2', at: '2026-07-25', forumId: 'sync', participants: ['pm', 'lead'] });
    assert.equal(lastContactWith(ws, 'lead'), '2026-07-25');
    assert.equal(lastContactWith(ws, 'ict'), null);
  });
});

describe('forum recency', () => {
  it('counts from the last time the forum was actually held', () => {
    let ws = seeded();
    ws = logInteraction(ws, { id: 'l1', at: '2026-07-20', forumId: 'sync', participants: ['pm'] });
    const sync = forumStatuses(ws, TODAY).find((f) => f.forumId === 'sync')!;
    assert.equal(sync.lastHeldAt, '2026-07-20');
    assert.equal(sync.dueAt, '2026-08-03');
    assert.equal(sync.overdueDays, 0);
  });

  it('flags a forum that has never been held since its anchor', () => {
    const oneone = forumStatuses(seeded(), TODAY).find((f) => f.forumId === 'oneone')!;
    assert.equal(oneone.lastHeldAt, null);
    assert.equal(oneone.severity, 'badly_overdue');
  });
});

describe('item staleness', () => {
  it('nags about a topic I have been sitting on past the cadence', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'i1', title: 'Access delay', target: { kind: 'person', id: 'lead' } });
    ws = backdate(ws, '2026-07-10T09:00:00Z'); // 22 days, cadence 7
    const nags = itemNags(ws, TODAY);
    assert.equal(nags.length, 1);
    assert.equal(nags[0]!.kind, 'unraised');
    assert.equal(nags[0]!.ageDays, 22);
    assert.equal(nags[0]!.severity, 'badly_overdue');
  });

  it('stays quiet about a topic raised only yesterday', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'i1', title: 'Fresh', target: { kind: 'person', id: 'lead' } });
    ws = backdate(ws, '2026-07-31T09:00:00Z');
    assert.deepEqual(itemNags(ws, TODAY), []);
  });

  it('chases an action they own that has not moved', () => {
    let ws = seeded();
    ws = addItem(ws, {
      id: 'i1',
      title: 'Escalate to ICT',
      target: { kind: 'person', id: 'lead' },
      ownerId: 'lead',
      state: 'open',
    });
    ws = backdate(ws, '2026-07-05T09:00:00Z');
    const nags = itemNags(ws, TODAY);
    assert.equal(nags[0]!.kind, 'awaiting_them');
    assert.equal(nags[0]!.ownerName, 'Lee');
  });

  it('flags anything past its due date first, whoever owns it', () => {
    let ws = seeded();
    ws = addItem(ws, {
      id: 'mine',
      title: 'Write the brief',
      target: { kind: 'person', id: 'lead' },
      state: 'open',
      dueDate: '2026-07-30',
    });
    const nags = itemNags(ws, TODAY);
    assert.equal(nags[0]!.kind, 'overdue_action');
    assert.equal(nags[0]!.ownerName, 'Me');
    assert.equal(nags[0]!.ageDays, 2);
  });

  it('never nags about resolved work', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'i1', title: 'Old', target: { kind: 'person', id: 'lead' } });
    ws = backdate(ws, '2026-06-01T09:00:00Z');
    ws = updateItem(ws, 'i1', { state: 'resolved' });
    assert.deepEqual(itemNags(ws, TODAY), []);
  });

  it('goes quiet on items about someone who is away', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'i1', title: 'Old', target: { kind: 'person', id: 'lead' } });
    ws = backdate(ws, '2026-06-01T09:00:00Z');
    ws = updatePerson(ws, 'lead', { away: [{ start: '2026-07-20', end: '2026-08-10' }] });
    assert.deepEqual(itemNags(ws, TODAY), []);
  });
});
