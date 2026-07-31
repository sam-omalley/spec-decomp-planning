/**
 * Component-level test (#163) for the Agenda's central claim: logging a
 * meeting is **one** step. The view fans a single interaction out into
 * several model changes — the contact record, a `lastRaisedAt` stamp on
 * every ticked item, a state transition on each one-shot topic, and the
 * actions agreed in the room — and the whole point of routing that through
 * one `logInteraction` commit is that undo takes all of it back together.
 * Wire it up as several commits instead and nothing looks broken until
 * someone hits ⌘Z after a meeting and gets half of it back.
 *
 * The other half is lifecycle rather than logic: the ticks, drafts and
 * participant list belong to the forum you're looking at, and an effect
 * clears them when you switch. A pure function can't capture either
 * property, which is what makes this worth a component test (see
 * CLAUDE.md) — the sections, sorting and staleness rules underneath are
 * covered by `agenda.test.ts` / `recency.test.ts`.
 *
 * No JSX (Node strips types but doesn't transform JSX) and every
 * component-test dependency is imported dynamically behind a `react` probe,
 * so a deps-less `npm test` skips this file rather than failing to load it
 * — see `Outliner.detailsCoalescing.test.ts` for the reference example.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addForum, addItem, addPerson, emptyWorkspace } from '../engagement/workspace.ts';
import type { Workspace } from '../engagement/types.ts';

let reactInstalled = true;
try {
  await import('react');
} catch {
  reactInstalled = false;
}

let deps:
  | {
      createElement: typeof import('react').createElement;
      cleanup: typeof import('@testing-library/react').cleanup;
      fireEvent: typeof import('@testing-library/react').fireEvent;
      render: typeof import('@testing-library/react').render;
      screen: typeof import('@testing-library/react').screen;
      EngagementAgenda: typeof import('./EngagementAgenda.tsx').EngagementAgenda;
      engagementStore: typeof import('../engagement/store.ts').engagementStore;
    }
  | undefined;

if (reactInstalled) {
  const [react, testingLibrary, agendaModule, storeModule] = await Promise.all([
    import('react'),
    import('@testing-library/react'),
    import('./EngagementAgenda.tsx'),
    import('../engagement/store.ts'),
  ]);
  deps = {
    createElement: react.createElement,
    cleanup: testingLibrary.cleanup,
    fireEvent: testingLibrary.fireEvent,
    render: testingLibrary.render,
    screen: testingLibrary.screen,
    EngagementAgenda: agendaModule.EngagementAgenda,
    engagementStore: storeModule.engagementStore,
  };
}

describe(
  'Agenda — logging a meeting (#163)',
  { skip: deps ? false : 'component-test deps not installed' },
  () => {
    const { createElement, cleanup, fireEvent, render, screen, EngagementAgenda, engagementStore } =
      deps!;

    /** A 1-1 with one open topic, plus a second forum to switch to. */
    function seed(): Workspace {
      let ws = emptyWorkspace();
      ws = addPerson(ws, { id: 'lead', name: 'Lee', role: 'My lead' });
      ws = addForum(ws, {
        id: 'oneone',
        name: '1-1',
        cadenceDays: 7,
        attendees: ['lead'],
        anchorDate: '2026-07-01',
      });
      ws = addForum(ws, { id: 'other', name: 'Other forum', cadenceDays: 30, attendees: ['lead'] });
      ws = addItem(ws, { id: 'topic', title: 'Access delay', target: { kind: 'person', id: 'lead' } });
      engagementStore.reset(ws);
      return ws;
    }

    function raiseCheckbox(): HTMLInputElement {
      const label = screen.getByTitle('Raised in this meeting');
      const input = label.querySelector('input');
      assert.ok(input, 'the raise control has a checkbox');
      return input as HTMLInputElement;
    }

    afterEach(() => {
      cleanup();
      engagementStore.reset(emptyWorkspace());
    });

    it('takes the whole meeting back in one undo', () => {
      seed();
      render(createElement(EngagementAgenda));

      fireEvent.click(raiseCheckbox());
      fireEvent.click(screen.getByText('+ Action'));
      fireEvent.change(screen.getByPlaceholderText('Action agreed…'), {
        target: { value: 'Chase ICT' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Log this meeting' }));

      const after = engagementStore.getState();
      assert.equal(after.interactions.length, 1, 'the contact is recorded');
      assert.ok(after.items['topic']!.lastRaisedAt, 'the ticked topic is stamped as raised');
      assert.equal(after.items['topic']!.state, 'open', 'a raised one-shot topic now awaits action');
      assert.equal(
        Object.values(after.items).filter((i) => i.title === 'Chase ICT').length,
        1,
        'the action agreed in the room was created',
      );

      // One step, not four: a single undo returns the whole meeting.
      engagementStore.undo();
      const before = engagementStore.getState();
      assert.equal(before.interactions.length, 0);
      assert.equal(before.items['topic']!.lastRaisedAt, null);
      assert.equal(before.items['topic']!.state, 'to_raise');
      assert.equal(Object.keys(before.items).length, 1, 'the created action went with it');
      assert.equal(engagementStore.canUndo, false, 'nothing else was committed separately');
    });

    it('refuses to log a meeting nobody attended', () => {
      seed();
      render(createElement(EngagementAgenda));

      // Untick the only attendee: with no participants there is nobody whose
      // recency this would reset, so the action is disabled rather than
      // silently recording a contact with no one.
      const present = screen.getAllByRole('checkbox').find((box) => {
        const label = box.closest('label');
        return label?.className.includes('engagement-attendee') ?? false;
      }) as HTMLInputElement;
      fireEvent.click(present);

      const submit = screen.getByRole('button', { name: 'Log this meeting' }) as HTMLButtonElement;
      assert.equal(submit.disabled, true);
      fireEvent.click(submit);
      assert.equal(engagementStore.getState().interactions.length, 0);
    });

    it('clears the in-progress meeting when you switch forum', () => {
      seed();
      render(createElement(EngagementAgenda));

      fireEvent.click(raiseCheckbox());
      assert.equal(raiseCheckbox().checked, true);

      fireEvent.click(screen.getByText('Other forum', { selector: '.agenda-forum-pill' }));
      fireEvent.click(screen.getByText('1-1', { selector: '.agenda-forum-pill' }));

      assert.equal(
        raiseCheckbox().checked,
        false,
        'ticks belonged to the meeting you walked away from',
      );
    });
  },
);
