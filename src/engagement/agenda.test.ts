import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { agendaFor, agendaItemIds, itemsForForum, standingDue } from './agenda.ts';
import { addForum, addItem, addPerson, emptyWorkspace, logInteraction, updateItem } from './workspace.ts';
import type { AgendaSection, AgendaSectionKind } from './agenda.ts';
import type { Workspace } from './types.ts';

const TODAY = '2026-08-01';

function backdate(ws: Workspace, createdAt: string): Workspace {
  const items: Workspace['items'] = {};
  for (const [id, item] of Object.entries(ws.items)) {
    items[id] = { ...item, createdAt, modifiedAt: createdAt };
  }
  return { ...ws, items };
}

/** A steering group with two attendees, plus one person outside it. */
function seeded(): Workspace {
  let ws = emptyWorkspace();
  ws = addPerson(ws, { id: 'pm', name: 'Pat', role: 'PM' });
  ws = addPerson(ws, { id: 'ict', name: 'Kim', role: 'ICT rep' });
  ws = addPerson(ws, { id: 'other', name: 'Sam', role: 'Elsewhere' });
  ws = addForum(ws, {
    id: 'steer',
    name: 'Steering group',
    cadenceDays: 28,
    attendees: ['pm', 'ict'],
    anchorDate: '2026-07-01',
  });
  return ws;
}

function section(sections: AgendaSection[], kind: AgendaSectionKind): AgendaSection | undefined {
  return sections.find((s) => s.kind === kind);
}

describe('agenda scope', () => {
  it('pulls items targeted at the forum and at anyone who attends it', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'room', title: 'Budget visibility', target: { kind: 'forum', id: 'steer' } });
    ws = addItem(ws, { id: 'personal', title: 'Access request', target: { kind: 'person', id: 'ict' } });
    ws = addItem(ws, { id: 'outside', title: 'Not here', target: { kind: 'person', id: 'other' } });
    const ids = itemsForForum(ws, 'steer').map((i) => i.id).sort();
    assert.deepEqual(ids, ['personal', 'room']);
  });

  it('leaves resolved and dropped items off entirely', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'done', title: 'Done', target: { kind: 'forum', id: 'steer' } });
    ws = updateItem(ws, 'done', { state: 'resolved' });
    ws = addItem(ws, { id: 'dropped', title: 'Dropped', target: { kind: 'forum', id: 'steer' } });
    ws = updateItem(ws, 'dropped', { state: 'dropped' });
    assert.deepEqual(itemsForForum(ws, 'steer'), []);
  });

  it('returns nothing for an unknown forum', () => {
    assert.deepEqual(itemsForForum(seeded(), 'ghost'), []);
    assert.deepEqual(agendaFor(seeded(), 'ghost', TODAY), []);
  });
});

describe('agenda sections', () => {
  it('splits by who owes the next move', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'topic', title: 'New concern', target: { kind: 'forum', id: 'steer' } });
    ws = addItem(ws, {
      id: 'theirs',
      title: 'They will chase ICT',
      target: { kind: 'person', id: 'pm' },
      ownerId: 'pm',
      state: 'open',
    });
    ws = addItem(ws, {
      id: 'mine',
      title: 'I will send the list',
      target: { kind: 'person', id: 'pm' },
      state: 'open',
    });
    const sections = agendaFor(ws, 'steer', TODAY);
    assert.deepEqual(
      sections.map((s) => s.kind),
      ['to_raise', 'chase', 'report_back'],
      'in conversation order, empty sections dropped',
    );
    assert.deepEqual(section(sections, 'chase')!.entries.map((e) => e.item.id), ['theirs']);
    assert.deepEqual(section(sections, 'report_back')!.entries.map((e) => e.item.id), ['mine']);
    assert.deepEqual(agendaItemIds(sections).sort(), ['mine', 'theirs', 'topic']);
  });

  it('shows a standing concern that has never been raised', () => {
    let ws = seeded();
    ws = addItem(ws, {
      id: 'standing',
      title: 'Team morale',
      target: { kind: 'forum', id: 'steer' },
      recurEveryDays: 28,
    });
    const sections = agendaFor(ws, 'steer', TODAY);
    assert.equal(section(sections, 'standing')!.entries[0]!.note, 'never raised');
  });

  it('drops a standing concern until its recurrence comes round again', () => {
    let ws = seeded();
    ws = addItem(ws, {
      id: 'standing',
      title: 'Team morale',
      target: { kind: 'forum', id: 'steer' },
      recurEveryDays: 28,
    });
    ws = logInteraction(ws, {
      id: 'log1',
      at: '2026-07-20',
      forumId: 'steer',
      participants: ['pm', 'ict'],
      raisedItemIds: ['standing'],
    });
    assert.equal(standingDue(ws.items['standing']!, TODAY), false);
    assert.deepEqual(agendaFor(ws, 'steer', TODAY), [], 'covered recently — not due again yet');
    assert.equal(standingDue(ws.items['standing']!, '2026-08-17'), true);
    const later = agendaFor(ws, 'steer', '2026-08-17');
    assert.equal(section(later, 'standing')!.entries[0]!.note, 'last raised 28d ago');
  });

  it('puts overdue entries first, then by due date', () => {
    let ws = seeded();
    ws = addItem(ws, {
      id: 'later',
      title: 'Later',
      target: { kind: 'forum', id: 'steer' },
      state: 'open',
      dueDate: '2026-08-20',
    });
    ws = addItem(ws, {
      id: 'soon',
      title: 'Soon',
      target: { kind: 'forum', id: 'steer' },
      state: 'open',
      dueDate: '2026-08-05',
    });
    ws = addItem(ws, {
      id: 'late',
      title: 'Late',
      target: { kind: 'forum', id: 'steer' },
      state: 'open',
      dueDate: '2026-07-25',
    });
    const entries = section(agendaFor(ws, 'steer', TODAY), 'report_back')!.entries;
    assert.deepEqual(entries.map((e) => e.item.id), ['late', 'soon', 'later']);
    assert.equal(entries[0]!.overdue, true);
    assert.equal(entries[0]!.note, 'due 7d ago');
  });

  it('notes how long an unraised topic has been waiting', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'topic', title: 'Old concern', target: { kind: 'forum', id: 'steer' } });
    ws = backdate(ws, '2026-07-18T09:00:00Z');
    const entry = section(agendaFor(ws, 'steer', TODAY), 'to_raise')!.entries[0]!;
    assert.equal(entry.note, 'open 14d');
  });
});
