import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGroup, createNode, emptyGraph, moveNode, rootsOf } from '../model/graph.ts';
import type { ProjectGraph } from '../model/types.ts';
import {
  indentTarget,
  insertionPointAfter,
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

  it('orders roots by rootOrder, not creation time', () => {
    assert.deepEqual(rootsOf(fixture()), ['app', 'docs']);
    const g = moveNode(fixture(), 'docs', null, 0);
    assert.deepEqual(
      visibleRows(g, none).map((r) => r.id),
      ['docs', 'app', 'auth', 'login', 'signup', 'billing'],
    );
  });
});

describe('group-side outlining', () => {
  it('flattens the delivery tree and computes targets with group root order', () => {
    let g = fixture();
    g = createGroup(g, { id: 'block1', title: 'Block 1' });
    g = createGroup(g, { id: 'epicA', title: 'Epic A' }, 'block1');
    g = createGroup(g, { id: 'block2', title: 'Block 2' });
    assert.deepEqual(
      visibleRows(g, none, 'group').map((r) => `${r.depth}:${r.id}`),
      ['0:block1', '1:epicA', '0:block2'],
    );
    assert.equal(indentTarget(g, 'block2'), 'block1');
    assert.deepEqual(outdentTarget(g, 'epicA'), { parentId: null, index: 1 });
    assert.deepEqual(reorderTarget(g, 'block2', -1), { parentId: null, index: 0 });
    assert.deepEqual(
      visibleRows(g, none).map((r) => r.id),
      ['app', 'auth', 'login', 'signup', 'billing', 'docs'],
      'work side unaffected',
    );
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
    assert.deepEqual(
      reorderTarget(fixture(), 'app', 1),
      { parentId: null, index: 1 },
      'roots reorder within rootOrder',
    );
    assert.equal(reorderTarget(fixture(), 'app', -1), null);
    assert.equal(reorderTarget(fixture(), 'docs', 1), null);
  });

  // Regression: Enter on an earlier root used to append the new sibling
  // at the end of the list instead of right after the cursor.
  it('creating a sibling after an earlier root inserts it there, not at the end', () => {
    let g = fixture();
    const { parentId, index } = insertionPointAfter(g, 'app');
    g = createNode(g, { id: 'new', title: 'New' });
    g = moveNode(g, 'new', parentId, index);
    assert.deepEqual(rootsOf(g), ['app', 'new', 'docs']);
  });

  // Regression: outdenting to root level used to lose the node's
  // position (it jumped to wherever createdAt sorted it).
  it('outdenting to root level lands right after the former parent', () => {
    let g = fixture();
    const target = outdentTarget(g, 'auth')!;
    assert.deepEqual(target, { parentId: null, index: 1 });
    g = moveNode(g, 'auth', target.parentId, target.index);
    assert.deepEqual(rootsOf(g), ['app', 'auth', 'docs']);
    assert.deepEqual(
      visibleRows(g, none).map((r) => `${r.depth}:${r.id}`),
      ['0:app', '1:billing', '0:auth', '1:login', '1:signup', '0:docs'],
    );
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
