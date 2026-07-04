import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createNode, emptyGraph, moveNode } from '../model/graph.ts';
import type { ProjectGraph } from '../model/types.ts';
import {
  indentTarget,
  insertionPointAfter,
  orderedRoots,
  outdentTarget,
  reorderTarget,
  visibleRows,
} from './outline.ts';

/**
 * app
 * ├─ auth
 * │  ├─ login
 * │  └─ signup
 * └─ billing
 * docs        (second root, created later)
 */
function fixture(): ProjectGraph {
  let g = emptyGraph();
  g = createNode(g, { id: 'app', title: 'App', createdAt: '2026-01-01T00:00:00Z' });
  g = createNode(g, { id: 'auth', title: 'Auth' }, 'app');
  g = createNode(g, { id: 'login', title: 'Login' }, 'auth');
  g = createNode(g, { id: 'signup', title: 'Signup' }, 'auth');
  g = createNode(g, { id: 'billing', title: 'Billing' }, 'app');
  g = createNode(g, { id: 'docs', title: 'Docs', createdAt: '2026-01-02T00:00:00Z' });
  return g;
}

const none: ReadonlySet<string> = new Set();

describe('visibleRows', () => {
  it('flattens depth-first with sibling order and depths', () => {
    const rows = visibleRows(fixture(), none);
    assert.deepEqual(
      rows.map((r) => `${r.depth}:${r.id}`),
      ['0:app', '1:auth', '2:login', '2:signup', '1:billing', '0:docs'],
    );
  });

  it('skips collapsed subtrees and flags the collapsed row', () => {
    const rows = visibleRows(fixture(), new Set(['auth']));
    assert.deepEqual(
      rows.map((r) => r.id),
      ['app', 'auth', 'billing', 'docs'],
    );
    assert.equal(rows.find((r) => r.id === 'auth')!.collapsed, true);
  });

  it('ignores collapsed marks on leaves', () => {
    const rows = visibleRows(fixture(), new Set(['login']));
    assert.equal(rows.find((r) => r.id === 'login')!.collapsed, false);
    assert.equal(rows.length, 6);
  });

  it('reflects reordering of siblings', () => {
    const g = moveNode(fixture(), 'billing', 'app', 0);
    const rows = visibleRows(g, none);
    assert.deepEqual(
      rows.map((r) => r.id),
      ['app', 'billing', 'auth', 'login', 'signup', 'docs'],
    );
  });

  it('orders roots by createdAt', () => {
    assert.deepEqual(orderedRoots(fixture()), ['app', 'docs']);
  });
});

describe('keyboard operation targets', () => {
  it('insertionPointAfter targets the slot after the node among its siblings', () => {
    assert.deepEqual(insertionPointAfter(fixture(), 'auth'), { parentId: 'app', index: 1 });
    assert.deepEqual(insertionPointAfter(fixture(), 'login'), { parentId: 'auth', index: 1 });
    assert.deepEqual(insertionPointAfter(fixture(), 'app'), { parentId: null, index: 1 });
  });

  it('indentTarget is the previous sibling, null for first siblings', () => {
    assert.equal(indentTarget(fixture(), 'billing'), 'auth');
    assert.equal(indentTarget(fixture(), 'auth'), null);
    assert.equal(indentTarget(fixture(), 'login'), null);
    assert.equal(indentTarget(fixture(), 'docs'), 'app', 'roots can indent under the previous root');
  });

  it('outdentTarget is the slot after the parent, null at root', () => {
    assert.deepEqual(outdentTarget(fixture(), 'login'), { parentId: 'app', index: 1 });
    assert.deepEqual(outdentTarget(fixture(), 'auth'), { parentId: null, index: 1 });
    assert.equal(outdentTarget(fixture(), 'app'), null);
  });

  it('reorderTarget moves within siblings and stops at edges', () => {
    assert.deepEqual(reorderTarget(fixture(), 'billing', -1), { parentId: 'app', index: 0 });
    assert.equal(reorderTarget(fixture(), 'billing', 1), null);
    assert.equal(reorderTarget(fixture(), 'auth', -1), null);
    assert.equal(reorderTarget(fixture(), 'app', 1), null, 'roots are not reorderable');
  });

  it('indent then outdent round-trips the tree shape', () => {
    let g = fixture();
    const target = indentTarget(g, 'billing')!;
    g = moveNode(g, 'billing', target);
    assert.deepEqual(
      visibleRows(g, none).map((r) => `${r.depth}:${r.id}`),
      ['0:app', '1:auth', '2:login', '2:signup', '2:billing', '0:docs'],
    );
    const out = outdentTarget(g, 'billing')!;
    g = moveNode(g, 'billing', out.parentId, out.index);
    assert.deepEqual(
      visibleRows(g, none).map((r) => `${r.depth}:${r.id}`),
      ['0:app', '1:auth', '2:login', '2:signup', '1:billing', '0:docs'],
    );
  });
});
