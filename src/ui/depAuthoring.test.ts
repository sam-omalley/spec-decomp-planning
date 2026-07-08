import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dragHandleVisibility, resolveDependencyEnds } from './depAuthoring.ts';

describe('resolveDependencyEnds', () => {
  it('right→left drag: source is the prerequisite, target the dependent', () => {
    assert.deepEqual(
      resolveDependencyEnds({ source: 'A', target: 'B', sourceHandle: 'r', targetHandle: 'l' }),
      { dependent: 'B', prerequisite: 'A' },
    );
  });

  it('left→right drag authors the same edge (drag direction is irrelevant)', () => {
    // B's left handle → A's right handle: B depends on A, same as above.
    assert.deepEqual(
      resolveDependencyEnds({ source: 'B', target: 'A', sourceHandle: 'l', targetHandle: 'r' }),
      { dependent: 'B', prerequisite: 'A' },
    );
  });

  it('rejects same-side connections (no left↔right flow)', () => {
    assert.equal(
      resolveDependencyEnds({ source: 'A', target: 'B', sourceHandle: 'l', targetHandle: 'l' }),
      null,
    );
    assert.equal(
      resolveDependencyEnds({ source: 'A', target: 'B', sourceHandle: 'r', targetHandle: 'r' }),
      null,
    );
  });

  it('rejects self-links and incomplete connections', () => {
    assert.equal(
      resolveDependencyEnds({ source: 'A', target: 'A', sourceHandle: 'r', targetHandle: 'l' }),
      null,
    );
    assert.equal(
      resolveDependencyEnds({ source: 'A', target: null, sourceHandle: 'r', targetHandle: 'l' }),
      null,
    );
  });
});

describe('dragHandleVisibility', () => {
  it('returns null when no connection is in progress', () => {
    assert.equal(dragHandleVisibility('A', null, null), null);
    assert.equal(dragHandleVisibility('A', 'A', null), null);
    assert.equal(dragHandleVisibility('A', 'A', 'x'), null);
  });

  it('drag from a right handle: from-card keeps only its right, others show only left', () => {
    // From B's right handle (B is the prerequisite). Valid targets are other
    // cards' left handles (they become the dependent).
    assert.deepEqual(dragHandleVisibility('B', 'B', 'r'), { left: 'hide', right: 'show' });
    assert.deepEqual(dragHandleVisibility('A', 'B', 'r'), { left: 'show', right: 'hide' });
    assert.deepEqual(dragHandleVisibility('C', 'B', 'r'), { left: 'show', right: 'hide' });
  });

  it('drag from a left handle: from-card keeps only its left, others show only right', () => {
    // From B's left handle (B is the dependent). Valid targets are other
    // cards' right handles (they become the prerequisite).
    assert.deepEqual(dragHandleVisibility('B', 'B', 'l'), { left: 'show', right: 'hide' });
    assert.deepEqual(dragHandleVisibility('A', 'B', 'l'), { left: 'hide', right: 'show' });
  });
});
