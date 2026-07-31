import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGAGEMENT_FILE_VERSION,
  deserializeWorkspace,
  serializeWorkspace,
  validateWorkspace,
} from './serialize.ts';
import {
  EngagementError,
  addForum,
  addItem,
  addPerson,
  emptyWorkspace,
  logInteraction,
} from './workspace.ts';
import type { Workspace } from './types.ts';

function seeded(): Workspace {
  let ws = emptyWorkspace();
  ws = addPerson(ws, { id: 'pm', name: 'Pat', role: 'PM' });
  ws = addForum(ws, { id: 'sync', name: 'Sync', cadenceDays: 14, attendees: ['pm'] });
  ws = addItem(ws, {
    id: 'topic',
    title: 'Access delay',
    target: { kind: 'person', id: 'pm' },
    link: { projectId: 'proj-1', nodeId: 'group-9', label: 'Auth epic' },
  });
  ws = logInteraction(ws, {
    id: 'log1',
    at: '2026-07-15',
    forumId: 'sync',
    participants: ['pm'],
    note: 'Escalating',
    raisedItemIds: ['topic'],
  });
  return ws;
}

describe('engagement serialize', () => {
  it('round-trips a workspace unchanged', () => {
    const before = seeded();
    const after = deserializeWorkspace(serializeWorkspace(before));
    assert.deepEqual(after, before);
  });

  it('keeps the soft project link across a round trip', () => {
    const after = deserializeWorkspace(serializeWorkspace(seeded()));
    assert.deepEqual(after.items['topic']!.link, {
      projectId: 'proj-1',
      nodeId: 'group-9',
      label: 'Auth epic',
    });
  });

  it('writes the current version envelope', () => {
    const parsed = JSON.parse(serializeWorkspace(emptyWorkspace())) as { version: number };
    assert.equal(parsed.version, ENGAGEMENT_FILE_VERSION);
  });

  it('rejects text that is not an engagement file, so a caller can back it up', () => {
    assert.throws(() => deserializeWorkspace('not json'), EngagementError);
    assert.throws(() => deserializeWorkspace('{"version":99,"workspace":{}}'), EngagementError);
  });
});

describe('engagement validate — repairs rather than rejects', () => {
  it('backfills every missing field', () => {
    const ws = validateWorkspace({ people: [{ id: 'p' }], forums: [{ id: 'f' }] });
    assert.equal(ws.people[0]!.name, 'Unnamed');
    assert.deepEqual(ws.people[0]!.away, []);
    assert.equal(ws.people[0]!.archivedAt, null);
    assert.equal(ws.forums[0]!.cadenceDays, 14);
    assert.deepEqual(ws.forums[0]!.attendees, []);
  });

  it('drops attendees, owners and participants whose person is gone', () => {
    const ws = validateWorkspace({
      people: [{ id: 'p', name: 'Real' }],
      forums: [{ id: 'f', name: 'F', cadenceDays: 7, attendees: ['p', 'ghost'] }],
      items: {
        i: { id: 'i', title: 'T', target: { kind: 'person', id: 'p' }, ownerId: 'ghost' },
      },
      interactions: [{ id: 'l', at: '2026-07-01', participants: ['p', 'ghost'] }],
    });
    assert.deepEqual(ws.forums[0]!.attendees, ['p']);
    assert.equal(ws.items['i']!.ownerId, null);
    assert.deepEqual(ws.interactions[0]!.participants, ['p']);
  });

  it('drops an item whose target no longer exists', () => {
    const ws = validateWorkspace({
      people: [],
      items: { orphan: { id: 'orphan', title: 'T', target: { kind: 'person', id: 'ghost' } } },
    });
    assert.deepEqual(ws.items, {});
  });

  it('re-roots a thread whose parent vanished', () => {
    const ws = validateWorkspace({
      people: [{ id: 'p', name: 'Real' }],
      items: {
        child: { id: 'child', title: 'T', target: { kind: 'person', id: 'p' }, parentId: 'gone' },
      },
    });
    assert.equal(ws.items['child']!.parentId, null);
  });

  it('breaks a thread cycle instead of hanging on it', () => {
    const ws = validateWorkspace({
      people: [{ id: 'p', name: 'Real' }],
      items: {
        a: { id: 'a', title: 'A', target: { kind: 'person', id: 'p' }, parentId: 'b' },
        b: { id: 'b', title: 'B', target: { kind: 'person', id: 'p' }, parentId: 'a' },
      },
    });
    const roots = Object.values(ws.items).filter((i) => i.parentId === null);
    assert.ok(roots.length >= 1, 'at least one end of the cycle was re-rooted');
  });

  it('drops log references to items that no longer exist', () => {
    const ws = validateWorkspace({
      people: [{ id: 'p', name: 'Real' }],
      items: {},
      interactions: [{ id: 'l', at: '2026-07-01', participants: ['p'], raisedItemIds: ['gone'] }],
    });
    assert.deepEqual(ws.interactions[0]!.raisedItemIds, []);
  });

  it('sorts the log newest-first on load', () => {
    const ws = validateWorkspace({
      people: [{ id: 'p', name: 'Real' }],
      interactions: [
        { id: 'old', at: '2026-06-01', participants: ['p'] },
        { id: 'new', at: '2026-08-01', participants: ['p'] },
      ],
    });
    assert.deepEqual(ws.interactions.map((i) => i.id), ['new', 'old']);
  });

  it('turns junk into an empty workspace rather than throwing', () => {
    assert.deepEqual(validateWorkspace(null), emptyWorkspace());
    assert.deepEqual(validateWorkspace('nonsense'), emptyWorkspace());
  });
});
