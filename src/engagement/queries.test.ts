import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { logEntries, openActions, personDossier } from './queries.ts';
import {
  addForum,
  addItem,
  addPerson,
  emptyWorkspace,
  logInteraction,
  removeItem,
  updateItem,
  updatePerson,
} from './workspace.ts';
import type { Workspace } from './types.ts';

const TODAY = '2026-08-01';

function backdate(ws: Workspace, createdAt: string): Workspace {
  const items: Workspace['items'] = {};
  for (const [id, item] of Object.entries(ws.items)) {
    items[id] = { ...item, createdAt, modifiedAt: createdAt };
  }
  return { ...ws, items };
}

function seeded(): Workspace {
  let ws = emptyWorkspace();
  ws = addPerson(ws, { id: 'pm', name: 'Pat', role: 'PM' });
  ws = addPerson(ws, { id: 'ict', name: 'Kim', role: 'ICT rep' });
  ws = addForum(ws, {
    id: 'steer',
    name: 'Steering group',
    cadenceDays: 28,
    attendees: ['pm', 'ict'],
    anchorDate: '2026-07-01',
  });
  return ws;
}

describe('openActions', () => {
  it('counts an unraised topic as an action on me', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'topic', title: 'Access delay', target: { kind: 'person', id: 'ict' } });
    const entries = openActions(ws, TODAY);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.kind, 'to_raise', 'a topic I owe is a follow-up reminder, not a chore');
    assert.equal(entries[0]!.ownerName, 'Me');
    assert.equal(entries[0]!.aboutName, 'Kim');
  });

  it('partitions cleanly into mine and theirs by owner', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'mine', title: 'Send the note', target: { kind: 'person', id: 'pm' }, state: 'open' });
    ws = addItem(ws, {
      id: 'theirs',
      title: 'Confirm the date',
      target: { kind: 'person', id: 'pm' },
      ownerId: 'pm',
      state: 'open',
    });
    const entries = openActions(ws, TODAY);
    assert.deepEqual(
      entries.filter((e) => e.item.ownerId === null).map((e) => e.item.id),
      ['mine'],
    );
    assert.deepEqual(
      entries.filter((e) => e.item.ownerId !== null).map((e) => e.item.id),
      ['theirs'],
    );
  });

  it('ranks a stale undated item above a dated one that is not due yet', () => {
    let ws = seeded();
    ws = addItem(ws, {
      id: 'dated',
      title: 'Not due for a while',
      target: { kind: 'forum', id: 'steer' },
      state: 'open',
      ownerId: 'pm',
      dueDate: '2026-08-20',
    });
    ws = addItem(ws, {
      id: 'stale',
      title: 'Nobody has touched this',
      target: { kind: 'forum', id: 'steer' },
      state: 'open',
      ownerId: 'pm',
    });
    ws = { ...ws, items: { ...ws.items, stale: { ...ws.items['stale']!, modifiedAt: '2026-06-01T09:00:00Z', createdAt: '2026-06-01T09:00:00Z' } } };
    assert.deepEqual(
      openActions(ws, TODAY).map((e) => e.item.id),
      ['stale', 'dated'],
    );
  });

  it('sorts most overdue first, then by due date, then longest untouched', () => {
    let ws = seeded();
    const mk = (id: string, dueDate: string | null) =>
      addItem(ws, { id, title: id, target: { kind: 'forum', id: 'steer' }, state: 'open', dueDate });
    ws = mk('late5', '2026-07-27');
    ws = mk('late1', '2026-07-31');
    ws = mk('soon', '2026-08-04');
    ws = mk('undated', null);
    assert.deepEqual(
      openActions(ws, TODAY).map((e) => e.item.id),
      ['late5', 'late1', 'soon', 'undated'],
    );
  });

  it('reports overdue and stale ages, and carries the nag reason', () => {
    let ws = seeded();
    ws = addItem(ws, {
      id: 'i1',
      title: 'Send the note',
      target: { kind: 'person', id: 'pm' },
      state: 'open',
      dueDate: '2026-07-25',
    });
    ws = backdate(ws, '2026-07-01T09:00:00Z');
    const entry = openActions(ws, TODAY)[0]!;
    assert.equal(entry.overdueDays, 7);
    assert.equal(entry.staleDays, 31);
    assert.equal(entry.nag, 'overdue_action');
    assert.notEqual(entry.severity, 'ok');
  });

  it('leaves resolved and dropped items out', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'done', title: 'Done', target: { kind: 'forum', id: 'steer' } });
    ws = updateItem(ws, 'done', { state: 'resolved' });
    assert.deepEqual(openActions(ws, TODAY), []);
  });
});

describe('logEntries', () => {
  function logged(): Workspace {
    let ws = seeded();
    ws = addItem(ws, { id: 'topic', title: 'Access delay', target: { kind: 'person', id: 'ict' } });
    ws = logInteraction(ws, {
      id: 'l1',
      at: '2026-07-10',
      forumId: 'steer',
      participants: ['pm', 'ict'],
      note: 'Covered scope',
      raisedItemIds: ['topic'],
      created: [{ id: 'act', title: 'Chase ICT', target: { kind: 'person', id: 'ict' }, ownerId: 'ict', state: 'open' }],
    });
    ws = logInteraction(ws, { id: 'l2', at: '2026-07-28', participants: ['pm'], note: 'Corridor chat' });
    return ws;
  }

  it('resolves names and attaches the items each contact touched', () => {
    const entries = logEntries(logged());
    assert.deepEqual(entries.map((e) => e.interaction.id), ['l2', 'l1'], 'newest first');
    const meeting = entries[1]!;
    assert.equal(meeting.forumName, 'Steering group');
    assert.deepEqual(meeting.participantNames, ['Pat', 'Kim']);
    assert.deepEqual(meeting.raised.map((i) => i.title), ['Access delay']);
    assert.deepEqual(meeting.created.map((i) => i.title), ['Chase ICT']);
  });

  it('marks ad-hoc contact as having no forum', () => {
    assert.equal(logEntries(logged())[0]!.forumName, null);
  });

  it('filters by person and by forum', () => {
    const ws = logged();
    assert.deepEqual(
      logEntries(ws, { personId: 'ict' }).map((e) => e.interaction.id),
      ['l1'],
    );
    assert.deepEqual(
      logEntries(ws, { forumId: 'steer' }).map((e) => e.interaction.id),
      ['l1'],
    );
    assert.equal(logEntries(ws, { personId: 'ict', forumId: null }).length, 1, 'null = unconstrained');
  });

  it('survives an item deleted after it was logged', () => {
    const ws = removeItem(logged(), 'topic');
    const meeting = logEntries(ws).find((e) => e.interaction.id === 'l1')!;
    assert.deepEqual(meeting.raised, [], 'the reference is gone, the record is not');
    assert.equal(meeting.interaction.note, 'Covered scope');
  });
});

describe('personDossier', () => {
  it('gathers standing, live items and history for one stakeholder', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'about', title: 'Access delay', target: { kind: 'person', id: 'ict' } });
    ws = addItem(ws, {
      id: 'theirs',
      title: 'Kim to unblock',
      target: { kind: 'forum', id: 'steer' },
      ownerId: 'ict',
      state: 'open',
    });
    ws = addItem(ws, { id: 'elsewhere', title: 'Pat thing', target: { kind: 'person', id: 'pm' } });
    ws = logInteraction(ws, { id: 'l1', at: '2026-07-20', forumId: 'steer', participants: ['pm', 'ict'] });

    const dossier = personDossier(ws, 'ict', TODAY)!;
    assert.equal(dossier.person.name, 'Kim');
    assert.equal(dossier.status.cadenceDays, 28);
    assert.equal(dossier.status.lastContactAt, '2026-07-20');
    assert.deepEqual(
      dossier.actions.map((e) => e.item.id).sort(),
      ['about', 'theirs'],
      'targeted at them or owed by them — never someone else’s',
    );
    assert.deepEqual(dossier.log.map((e) => e.interaction.id), ['l1']);
  });

  it('excludes a forum-targeted item they merely attend', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'room', title: 'Budget visibility', target: { kind: 'forum', id: 'steer' } });
    assert.deepEqual(personDossier(ws, 'ict', TODAY)!.actions, [], 'belongs to the room, not to Kim');
  });

  it('still reads for an archived person, with no standing', () => {
    let ws = seeded();
    ws = logInteraction(ws, { id: 'l1', at: '2026-07-20', participants: ['ict'] });
    ws = updatePerson(ws, 'ict', { archivedAt: '2026-07-25T00:00:00Z' });
    const dossier = personDossier(ws, 'ict', TODAY)!;
    assert.equal(dossier.status.cadenceDays, null);
    assert.equal(dossier.status.severity, 'ok');
    assert.equal(dossier.log.length, 1, 'the history survives the archive');
  });

  it('returns null for someone who does not exist', () => {
    assert.equal(personDossier(seeded(), 'ghost', TODAY), null);
  });
});
