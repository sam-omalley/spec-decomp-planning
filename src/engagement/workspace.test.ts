import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EngagementError,
  addForum,
  addItem,
  addPerson,
  childItems,
  emptyWorkspace,
  itemSubtree,
  logInteraction,
  openItems,
  removeForum,
  removeItem,
  removePerson,
  reopenItem,
  resolveItem,
  setForumAttendee,
  updateForum,
  updateItem,
  updatePerson,
} from './workspace.ts';
import type { Workspace } from './types.ts';

/** A workspace with a PM, a lead, and a fortnightly forum both attend. */
function seeded(): Workspace {
  let ws = emptyWorkspace();
  ws = addPerson(ws, { id: 'pm', name: 'Pat', role: 'PM' });
  ws = addPerson(ws, { id: 'lead', name: 'Lee', role: 'My lead' });
  ws = addForum(ws, {
    id: 'sync',
    name: 'Delivery sync',
    cadenceDays: 14,
    attendees: ['pm', 'lead'],
    anchorDate: '2026-01-01',
  });
  return ws;
}

describe('engagement workspace — people & forums', () => {
  it('adds people and forums', () => {
    const ws = seeded();
    assert.equal(ws.people.length, 2);
    assert.equal(ws.forums[0]!.attendees.length, 2);
  });

  it('rejects a non-positive cadence', () => {
    assert.throws(
      () => addForum(seeded(), { id: 'f', name: 'F', cadenceDays: 0 }),
      EngagementError,
    );
    assert.throws(() => updateForum(seeded(), 'sync', { cadenceDays: -1 }), EngagementError);
  });

  it('allows a blank name, so the editor can add a row to type into', () => {
    const ws = addPerson(emptyWorkspace(), { id: 'x', name: '' });
    assert.equal(ws.people[0]!.name, '');
  });

  it('rejects a forum with an unknown attendee', () => {
    assert.throws(
      () => addForum(seeded(), { id: 'f', name: 'F', cadenceDays: 7, attendees: ['ghost'] }),
      EngagementError,
    );
  });

  it('toggles one attendee without disturbing the rest', () => {
    let ws = seeded();
    ws = setForumAttendee(ws, 'sync', 'pm', false);
    assert.deepEqual(ws.forums[0]!.attendees, ['lead']);
    ws = setForumAttendee(ws, 'sync', 'pm', true);
    assert.deepEqual(ws.forums[0]!.attendees, ['lead', 'pm']);
  });

  it('setting an attendee to its current value is a no-op by reference', () => {
    const ws = seeded();
    assert.equal(setForumAttendee(ws, 'sync', 'pm', true), ws);
  });

  it('refuses to delete a person who has history, so the record survives', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'i1', title: 'Access request', target: { kind: 'person', id: 'pm' } });
    assert.throws(() => removePerson(ws, 'pm'), EngagementError);
    // Archiving is the non-destructive alternative.
    ws = updatePerson(ws, 'pm', { archivedAt: '2026-08-01T00:00:00Z' });
    assert.equal(ws.people.find((p) => p.id === 'pm')!.archivedAt, '2026-08-01T00:00:00Z');
    assert.ok(ws.items['i1'], 'their history is untouched');
  });

  it('deletes a person with no history, and unseats them', () => {
    const ws = removePerson(seeded(), 'pm');
    assert.equal(ws.people.length, 1);
    assert.deepEqual(ws.forums[0]!.attendees, ['lead']);
  });

  it('refuses to delete a forum that items or meetings reference', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'i1', title: 'Budget', target: { kind: 'forum', id: 'sync' } });
    assert.throws(() => removeForum(ws, 'sync'), EngagementError);
  });

  it('mutations never touch the workspace they were given', () => {
    const before = seeded();
    const peopleBefore = before.people.length;
    addPerson(before, { id: 'new', name: 'New' });
    assert.equal(before.people.length, peopleBefore);
  });
});

describe('engagement workspace — items', () => {
  it('defaults a new item to a topic I owe, targeted where I said', () => {
    const ws = addItem(seeded(), {
      id: 'i1',
      title: 'Raise the access delay',
      target: { kind: 'person', id: 'pm' },
    });
    const item = ws.items['i1']!;
    assert.equal(item.state, 'to_raise');
    assert.equal(item.ownerId, null, 'null owner = mine');
    assert.equal(item.lastRaisedAt, null);
  });

  it('rejects an unknown target, owner or parent', () => {
    const ws = seeded();
    assert.throws(
      () => addItem(ws, { id: 'i', title: 'T', target: { kind: 'person', id: 'ghost' } }),
      EngagementError,
    );
    assert.throws(
      () =>
        addItem(ws, {
          id: 'i',
          title: 'T',
          target: { kind: 'person', id: 'pm' },
          ownerId: 'ghost',
        }),
      EngagementError,
    );
    assert.throws(
      () =>
        addItem(ws, {
          id: 'i',
          title: 'T',
          target: { kind: 'person', id: 'pm' },
          parentId: 'ghost',
        }),
      EngagementError,
    );
  });

  it('threads follow-ups under their topic, in insertion order', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'topic', title: 'Access', target: { kind: 'person', id: 'pm' } });
    ws = addItem(ws, { id: 'a1', title: 'Chase ICT', target: { kind: 'person', id: 'pm' }, parentId: 'topic' });
    ws = addItem(ws, { id: 'a2', title: 'Send list', target: { kind: 'person', id: 'pm' }, parentId: 'topic' });
    assert.deepEqual(
      childItems(ws, 'topic').map((i) => i.id),
      ['a1', 'a2'],
    );
    assert.deepEqual(itemSubtree(ws, 'topic'), ['topic', 'a1', 'a2']);
  });

  it('refuses to thread an item under its own descendant', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'topic', title: 'Access', target: { kind: 'person', id: 'pm' } });
    ws = addItem(ws, { id: 'a1', title: 'Chase', target: { kind: 'person', id: 'pm' }, parentId: 'topic' });
    assert.throws(() => updateItem(ws, 'topic', { parentId: 'a1' }), EngagementError);
    assert.throws(() => updateItem(ws, 'topic', { parentId: 'topic' }), EngagementError);
  });

  it('deleting a topic takes its thread and scrubs the log references', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'topic', title: 'Access', target: { kind: 'person', id: 'pm' } });
    ws = addItem(ws, { id: 'a1', title: 'Chase', target: { kind: 'person', id: 'pm' }, parentId: 'topic' });
    ws = logInteraction(ws, {
      id: 'log1',
      at: '2026-07-01',
      forumId: 'sync',
      participants: ['pm'],
      raisedItemIds: ['topic'],
    });
    ws = removeItem(ws, 'topic');
    assert.equal(ws.items['topic'], undefined);
    assert.equal(ws.items['a1'], undefined, 'thread went with it');
    assert.deepEqual(ws.interactions[0]!.raisedItemIds, [], 'no dangling reference');
    assert.equal(ws.interactions.length, 1, 'the meeting itself is still history');
  });

  it('records a resolution, and reopening clears it', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'i1', title: 'Access', target: { kind: 'person', id: 'pm' } });
    ws = resolveItem(ws, 'i1', 'Granted on Friday', '2026-07-10');
    assert.equal(ws.items['i1']!.state, 'resolved');
    assert.equal(ws.items['i1']!.resolution, 'Granted on Friday');
    assert.equal(openItems(ws).length, 0);
    ws = reopenItem(ws, 'i1');
    assert.equal(ws.items['i1']!.state, 'to_raise', 'never raised, so back to the to-raise list');
    assert.equal(ws.items['i1']!.resolvedAt, null);
  });
});

describe('engagement workspace — logging a meeting', () => {
  it('stamps raised items, creates agreed actions, and appends the log in one step', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'topic', title: 'Access delay', target: { kind: 'person', id: 'pm' } });
    ws = logInteraction(ws, {
      id: 'log1',
      at: '2026-07-15',
      forumId: 'sync',
      participants: ['pm', 'lead'],
      note: 'Agreed to escalate',
      raisedItemIds: ['topic'],
      created: [
        {
          id: 'act1',
          title: 'Escalate to ICT',
          target: { kind: 'person', id: 'pm' },
          ownerId: 'pm',
          state: 'open',
          parentId: 'topic',
        },
      ],
    });
    assert.equal(ws.items['topic']!.lastRaisedAt, '2026-07-15');
    assert.equal(ws.items['topic']!.state, 'open', 'a raised one-shot topic now awaits an action');
    assert.equal(ws.items['act1']!.ownerId, 'pm');
    assert.equal(ws.items['act1']!.parentId, 'topic');
    assert.deepEqual(ws.interactions[0]!.createdItemIds, ['act1']);
  });

  it('leaves a standing concern to_raise — it is never done being raised', () => {
    let ws = seeded();
    ws = addItem(ws, {
      id: 'standing',
      title: 'Team morale',
      target: { kind: 'forum', id: 'sync' },
      recurEveryDays: 28,
    });
    ws = logInteraction(ws, {
      id: 'log1',
      at: '2026-07-15',
      forumId: 'sync',
      participants: ['pm'],
      raisedItemIds: ['standing'],
    });
    assert.equal(ws.items['standing']!.state, 'to_raise');
    assert.equal(ws.items['standing']!.lastRaisedAt, '2026-07-15');
  });

  it('keeps the log newest-first however it is entered', () => {
    let ws = seeded();
    ws = logInteraction(ws, { id: 'a', at: '2026-07-01', participants: ['pm'] });
    ws = logInteraction(ws, { id: 'b', at: '2026-06-01', participants: ['pm'] });
    ws = logInteraction(ws, { id: 'c', at: '2026-08-01', participants: ['pm'] });
    assert.deepEqual(
      ws.interactions.map((i) => i.id),
      ['c', 'a', 'b'],
    );
  });

  it('rejects unknown participants, forums or raised items — and changes nothing', () => {
    const ws = seeded();
    assert.throws(
      () => logInteraction(ws, { id: 'l', participants: ['ghost'] }),
      EngagementError,
    );
    assert.throws(
      () => logInteraction(ws, { id: 'l', participants: ['pm'], forumId: 'ghost' }),
      EngagementError,
    );
    assert.throws(
      () => logInteraction(ws, { id: 'l', participants: ['pm'], raisedItemIds: ['ghost'] }),
      EngagementError,
    );
    assert.equal(ws.interactions.length, 0);
  });
});
