import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { agendaMarkdown } from './agendaMarkdown.ts';
import { addForum, addItem, addPerson, emptyWorkspace, logInteraction } from './workspace.ts';
import type { Workspace } from './types.ts';

const TODAY = '2026-08-01';

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

describe('agendaMarkdown', () => {
  it('heads the document with the forum, date, attendees and cadence', () => {
    let ws = seeded();
    ws = logInteraction(ws, { id: 'l1', at: '2026-07-10', forumId: 'steer', participants: ['pm'] });
    const md = agendaMarkdown(ws, 'steer', TODAY);
    assert.match(md, /^# Steering group — 2026-08-01\n/);
    assert.match(md, /\*\*Attending:\*\* Pat, Kim/);
    assert.match(md, /_Every 28 days · last held 2026-07-10_/);
  });

  it('says so plainly rather than pasting a blank agenda', () => {
    const md = agendaMarkdown(seeded(), 'steer', TODAY);
    assert.match(md, /Nothing outstanding for this forum\./);
    assert.doesNotMatch(md, /##/);
  });

  it('writes one section per non-empty bucket, with the owner and the note', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'topic', title: 'Access delay', target: { kind: 'forum', id: 'steer' } });
    ws = addItem(ws, {
      id: 'theirs',
      title: 'Confirm the vendor date',
      target: { kind: 'person', id: 'pm' },
      ownerId: 'pm',
      state: 'open',
      dueDate: '2026-07-25',
    });
    const md = agendaMarkdown(ws, 'steer', TODAY);
    assert.match(md, /## To raise\n\n- Access delay/);
    assert.match(md, /## Chasing them\n\n- Confirm the vendor date — Pat \(due 7d ago\)/);
    assert.doesNotMatch(md, /## Standing items/, 'empty buckets are left out');
    assert.doesNotMatch(md, /## I owe them/);
  });

  it('carries an item’s details into the paste, indented under it', () => {
    let ws = seeded();
    ws = addItem(ws, {
      id: 'topic',
      title: 'Access delay',
      target: { kind: 'forum', id: 'steer' },
      details: 'Two devs, three weeks.\nEscalate if no date.',
    });
    const md = agendaMarkdown(ws, 'steer', TODAY);
    assert.match(md, /- Access delay.*\n {2}Two devs, three weeks\.\n {2}Escalate if no date\./);
  });

  it('ends with exactly one newline and no trailing blank section', () => {
    let ws = seeded();
    ws = addItem(ws, { id: 'topic', title: 'Access delay', target: { kind: 'forum', id: 'steer' } });
    const md = agendaMarkdown(ws, 'steer', TODAY);
    assert.equal(md.endsWith('\n'), true);
    assert.equal(md.endsWith('\n\n'), false, 'no blank line left by the section separator');
    assert.match(md.trimEnd().split('\n').at(-1)!, /^- Access delay/);
  });

  it('returns empty for a forum that does not exist', () => {
    assert.equal(agendaMarkdown(seeded(), 'ghost', TODAY), '');
  });
});
