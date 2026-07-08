import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDependencyEnds } from './depAuthoring.ts';

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
