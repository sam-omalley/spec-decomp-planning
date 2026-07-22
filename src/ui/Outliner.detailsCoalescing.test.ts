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
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createNode, emptyGraph } from '../model/graph.ts';
import { store } from '../store/appStore.ts';
import { Outliner } from './Outliner.tsx';

function Harness() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return createElement(Outliner, { side: 'work', selectedId, onSelect: setSelectedId });
}

function seed(): void {
  let g = emptyGraph();
  g = createNode(g, { id: 'n1', title: 'Node 1' });
  store.reset(g);
}

describe('Outliner — details card coalescing (#136)', () => {
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
