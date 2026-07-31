/**
 * Component-level regression test (#163) for the item details editor's
 * coalescing contract — the same invisible-when-broken rule
 * `Outliner.detailsCoalescing.test.ts` pins on the plan side, now that the
 * engagement rows have their own details editor with its own
 * `item-details:<id>` coalesce key.
 *
 * Typing inside one visit is one undo step; two separate visits to the
 * same item must never collapse into one. The mechanism is
 * `ItemControls`'s explicit `breakCoalescing()` on toggle, which exists
 * because the textarea's `onBlur` does not fire when it unmounts — get it
 * wrong and closing, reopening and editing again silently swallows the
 * first session on undo.
 *
 * No JSX (Node strips types but doesn't transform JSX), and every
 * component-test dependency loads dynamically behind a `react` probe so a
 * deps-less `npm test` skips the file rather than failing to load it.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addItem, addPerson, emptyWorkspace } from '../engagement/workspace.ts';
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
      EngagementActions: typeof import('./EngagementActions.tsx').EngagementActions;
      engagementStore: typeof import('../engagement/store.ts').engagementStore;
    }
  | undefined;

if (reactInstalled) {
  const [react, testingLibrary, actionsModule, storeModule] = await Promise.all([
    import('react'),
    import('@testing-library/react'),
    import('./EngagementActions.tsx'),
    import('../engagement/store.ts'),
  ]);
  deps = {
    createElement: react.createElement,
    cleanup: testingLibrary.cleanup,
    fireEvent: testingLibrary.fireEvent,
    render: testingLibrary.render,
    screen: testingLibrary.screen,
    EngagementActions: actionsModule.EngagementActions,
    engagementStore: storeModule.engagementStore,
  };
}

describe(
  'Engagement item details — coalescing (#163)',
  { skip: deps ? false : 'component-test deps not installed' },
  () => {
    const { createElement, cleanup, fireEvent, render, screen, EngagementActions, engagementStore } =
      deps!;

    function seed(): Workspace {
      let ws = emptyWorkspace();
      ws = addPerson(ws, { id: 'pm', name: 'Pat' });
      ws = addItem(ws, { id: 'i1', title: 'Access delay', target: { kind: 'person', id: 'pm' } });
      engagementStore.reset(ws);
      return ws;
    }

    const toggle = () => screen.getByTitle(/details/i);
    const details = () => engagementStore.getState().items['i1']!.details;

    afterEach(() => {
      cleanup();
      engagementStore.reset(emptyWorkspace());
    });

    it('collapses the keystrokes of one visit into a single undo step', () => {
      seed();
      render(createElement(EngagementActions));

      fireEvent.click(toggle());
      const textarea = screen.getByPlaceholderText('Details…');
      fireEvent.change(textarea, { target: { value: 'Two' } });
      fireEvent.change(textarea, { target: { value: 'Two devs' } });
      fireEvent.change(textarea, { target: { value: 'Two devs, three weeks' } });
      assert.equal(details(), 'Two devs, three weeks');

      engagementStore.undo();
      assert.equal(details(), '', 'the whole visit came back in one step');
    });

    it('keeps two visits to the same item as separate undo steps', () => {
      seed();
      render(createElement(EngagementActions));

      fireEvent.click(toggle());
      fireEvent.change(screen.getByPlaceholderText('Details…'), {
        target: { value: 'first session' },
      });
      fireEvent.click(toggle()); // closes — unmounts without firing blur

      fireEvent.click(toggle()); // reopens
      fireEvent.change(screen.getByPlaceholderText('Details…'), {
        target: { value: 'first sessionsecond session' },
      });

      // Had the visits coalesced (same key both times), one undo would jump
      // straight back to empty.
      engagementStore.undo();
      assert.equal(details(), 'first session');
      engagementStore.undo();
      assert.equal(details(), '');
    });

    it('marks the indicator once the item has something to read', () => {
      seed();
      render(createElement(EngagementActions));
      assert.equal(toggle().className.includes('item-details-toggle-set'), false);

      fireEvent.click(toggle());
      fireEvent.change(screen.getByPlaceholderText('Details…'), { target: { value: 'a note' } });
      assert.equal(toggle().className.includes('item-details-toggle-set'), true);
    });
  },
);
