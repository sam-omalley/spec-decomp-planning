/**
 * Component-level regression test (#136) for the details-card coalescing
 * contract CLAUDE.md calls out as subtle and invisible-when-broken: two
 * separate visits to the same node's details card must never collapse into
 * one undo step, even though both use the same `details:<id>` coalesce
 * key. Get it wrong and a whole editing session vanishes into the
 * previous one on undo.
 *
 * This exercises the real close→reopen flow end to end rather than
 * isolating `toggleDetails`'s own `breakCoalescing()` call in particular:
 * closing the card also hands focus back to the row's title input (a
 * separate effect), and reopening autofocuses the new textarea — a real
 * focus transfer away from that input, which fires its own `onBlur` (also
 * `breakCoalescing()`) as an incidental second line of defense. Both
 * mechanisms would have to regress together to break this test, which is
 * a fair reflection of what would actually have to go wrong for a user to
 * see it.
 *
 * No JSX: Node's `--experimental-strip-types` strips TypeScript syntax but
 * doesn't transform JSX, so elements are built with `React.createElement`.
 *
 * react/@testing-library/react, the .tsx Outliner import, and even the
 * `store` import are all loaded dynamically (`store` pulls in
 * `appStore.ts`, which imports `react` unconditionally for its
 * `useSyncExternalStore` binding, so a plain static import of it fails the
 * same way) — then the whole suite is registered with `skip` if `react`
 * itself isn't resolvable. `describe`'s callback never runs when skipped,
 * so this never throws on a load-hook-less/deps-less run. Without this, a
 * dep-less `npm test` (the domain suite's "no `npm install` needed"
 * property, see testSetup.ts) would exit red on this one file's unguarded
 * static imports even though every domain test passed.
 *
 * Only the `react` probe is inside a try/catch — it's the sentinel for
 * "are component-test deps installed at all". The rest load unguarded
 * once that succeeds, so a genuine runtime failure in Outliner.tsx or
 * appStore.ts (as opposed to deps simply being absent) throws and fails
 * the file loudly instead of being swallowed as "deps not installed".
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createNode, emptyGraph } from '../model/graph.ts';

let reactInstalled = true;
try {
  await import('react');
} catch {
  reactInstalled = false;
}

let deps:
  | {
      createElement: typeof import('react').createElement;
      useState: typeof import('react').useState;
      cleanup: typeof import('@testing-library/react').cleanup;
      fireEvent: typeof import('@testing-library/react').fireEvent;
      render: typeof import('@testing-library/react').render;
      screen: typeof import('@testing-library/react').screen;
      Outliner: typeof import('./Outliner.tsx').Outliner;
      store: typeof import('../store/appStore.ts').store;
    }
  | undefined;

if (reactInstalled) {
  const [react, testingLibrary, outlinerModule, appStoreModule] = await Promise.all([
    import('react'),
    import('@testing-library/react'),
    import('./Outliner.tsx'),
    import('../store/appStore.ts'),
  ]);
  deps = {
    createElement: react.createElement,
    useState: react.useState,
    cleanup: testingLibrary.cleanup,
    fireEvent: testingLibrary.fireEvent,
    render: testingLibrary.render,
    screen: testingLibrary.screen,
    Outliner: outlinerModule.Outliner,
    store: appStoreModule.store,
  };
}

describe('Outliner — details card coalescing (#136)', { skip: deps ? false : 'component-test deps not installed' }, () => {
  const { createElement, useState, cleanup, fireEvent, render, screen, Outliner, store } = deps!;

  function Harness() {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    return createElement(Outliner, { side: 'work', selectedId, onSelect: setSelectedId });
  }

  function seed(): void {
    let g = emptyGraph();
    g = createNode(g, { id: 'n1', title: 'Node 1' });
    store.reset(g);
  }

  afterEach(() => {
    cleanup();
  });

  it('breaks coalescing between two visits to the same node’s details card', () => {
    seed();
    render(createElement(Harness));

    fireEvent.click(screen.getByTitle('Add details (⌘↩)'));
    const textarea1 = screen.getByPlaceholderText('Details…');
    fireEvent.change(textarea1, { target: { value: 'first session' } });
    assert.equal(store.getState().nodes['n1']!.description, 'first session');

    fireEvent.keyDown(textarea1, { key: 'Escape' }); // closes the card

    // Revisit the same node's details and edit again.
    fireEvent.click(screen.getByTitle('Show details (⌘↩)'));
    const textarea2 = screen.getByPlaceholderText('Details…');
    fireEvent.change(textarea2, { target: { value: 'first sessionsecond session' } });
    assert.equal(store.getState().nodes['n1']!.description, 'first sessionsecond session');

    // Had the two sessions coalesced (same coalesce key, `details:n1`, both
    // times), one undo would jump straight back to the empty description.
    // They must land on the first session's value instead.
    store.undo();
    assert.equal(store.getState().nodes['n1']!.description, 'first session');
    store.undo();
    assert.equal(store.getState().nodes['n1']!.description, '');
    assert.equal(store.canUndo, false);
  });

  it('does not break coalescing for keystrokes within a single visit', () => {
    seed();
    render(createElement(Harness));

    fireEvent.click(screen.getByTitle('Add details (⌘↩)'));
    const textarea = screen.getByPlaceholderText('Details…');
    fireEvent.change(textarea, { target: { value: 'f' } });
    fireEvent.change(textarea, { target: { value: 'fi' } });
    fireEvent.change(textarea, { target: { value: 'fin' } });
    assert.equal(store.getState().nodes['n1']!.description, 'fin');

    // Three keystrokes in one visit must be one undo step, not three.
    store.undo();
    assert.equal(store.getState().nodes['n1']!.description, '');
    assert.equal(store.canUndo, false);
  });
});
