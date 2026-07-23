import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignToGroup,
  createGroup,
  createNode,
  emptyGraph,
  updateNode,
} from '../model/graph.ts';
import type { ProjectGraph } from '../model/types.ts';
import {
  coveringGroups,
  isEmptyLeafGroup,
  isUncovered,
  overlappingMembers,
  rootGroupOf,
  uncoveredForest,
  uncoveredWorkIds,
} from './planning.ts';

/**
 * Spec:  app ─┬─ auth ─┬─ login
 *             │        └─ signup
 *             └─ billing
 * Delivery:  block1 ─┬─ epicA
 *                    └─ epicB
 *            block2
 */
function fixture(): ProjectGraph {
  let g = emptyGraph();
  g = createNode(g, { id: 'app', title: 'App' });
  g = createNode(g, { id: 'auth', title: 'Auth' }, 'app');
  g = createNode(g, { id: 'login', title: 'Login' }, 'auth');
  g = createNode(g, { id: 'signup', title: 'Signup' }, 'auth');
  g = createNode(g, { id: 'billing', title: 'Billing' }, 'app');
  g = createGroup(g, { id: 'block1', title: 'Block 1' });
  g = createGroup(g, { id: 'epicA', title: 'Epic A' }, 'block1');
  g = createGroup(g, { id: 'epicB', title: 'Epic B' }, 'block1');
  g = createGroup(g, { id: 'block2', title: 'Block 2' });
  return g;
}

describe('coveringGroups', () => {
  it('reports the direct assignment as via-self', () => {
    const g = assignToGroup(fixture(), 'login', 'epicA');
    assert.deepEqual(coveringGroups(g, 'login'), [{ groupId: 'epicA', via: 'login' }]);
    assert.deepEqual(coveringGroups(g, 'signup'), []);
  });

  it('deduplicates by group: nearest carrier wins', () => {
    let g = fixture();
    g = assignToGroup(g, 'auth', 'epicA');
    g = assignToGroup(g, 'login', 'epicA');
    assert.deepEqual(coveringGroups(g, 'login'), [{ groupId: 'epicA', via: 'login' }]);
  });

  it('inherits coverage from spec ancestors, nearest first', () => {
    let g = fixture();
    g = assignToGroup(g, 'app', 'block1');
    g = assignToGroup(g, 'auth', 'epicA');
    assert.deepEqual(coveringGroups(g, 'login'), [
      { groupId: 'epicA', via: 'auth' },
      { groupId: 'block1', via: 'app' },
    ]);
    assert.deepEqual(coveringGroups(g, 'billing'), [{ groupId: 'block1', via: 'app' }]);
  });
});

describe('overlappingMembers', () => {
  it('flags a member whose descendant is assigned to a sibling group', () => {
    let g = fixture();
    g = assignToGroup(g, 'auth', 'epicA');
    g = assignToGroup(g, 'login', 'epicB');
    assert.deepEqual(overlappingMembers(g, 'epicA'), ['auth']);
    assert.deepEqual(overlappingMembers(g, 'epicB'), []);
  });

  it('treats assignment within the member group subtree as refinement, not overlap', () => {
    let g = fixture();
    g = assignToGroup(g, 'auth', 'block1');
    g = assignToGroup(g, 'login', 'epicA');
    assert.deepEqual(overlappingMembers(g, 'block1'), [], 'epicA is inside block1');
  });

  it('flags assignment to a coarser ancestor group or another block', () => {
    let g = fixture();
    g = assignToGroup(g, 'auth', 'epicA');
    g = assignToGroup(g, 'login', 'block1');
    assert.deepEqual(overlappingMembers(g, 'epicA'), ['auth'], 'block1 is above epicA');

    let h = fixture();
    h = assignToGroup(h, 'auth', 'epicA');
    h = assignToGroup(h, 'signup', 'block2');
    assert.deepEqual(overlappingMembers(h, 'epicA'), ['auth'], 'block2 is unrelated');
  });

  it('ignores unassigned descendants', () => {
    const g = assignToGroup(fixture(), 'app', 'block1');
    assert.deepEqual(overlappingMembers(g, 'block1'), []);
  });
});

describe('uncoveredWorkIds', () => {
  it('lists every work node no group covers, and shrinks by inheritance', () => {
    const g = fixture();
    // Nothing assigned: all five work nodes are uncovered.
    assert.deepEqual(
      [...uncoveredWorkIds(g)].sort(),
      ['app', 'auth', 'billing', 'login', 'signup'],
    );

    // Assigning an ancestor covers its whole subtree via inheritance.
    const h = assignToGroup(g, 'auth', 'epicA');
    assert.equal(isUncovered(h, 'login'), false, 'inherits from auth');
    assert.deepEqual([...uncoveredWorkIds(h)].sort(), ['app', 'billing']);
  });

  it('excludes groups — only work nodes can be uncovered', () => {
    const ids = uncoveredWorkIds(fixture());
    assert.equal(ids.has('block1'), false);
    assert.equal(ids.has('epicA'), false);
  });

  it('assignment to a parking-lot group still counts as coverage (#155)', () => {
    let g = fixture();
    g = updateNode(g, 'epicA', { parkingLot: true });
    g = assignToGroup(g, 'login', 'epicA');
    assert.equal(isUncovered(g, 'login'), false);
    assert.deepEqual([...uncoveredWorkIds(g)].sort(), ['app', 'auth', 'billing', 'signup']);
  });
});

describe('uncoveredForest', () => {
  it('nests the full tree under the uncovered root when nothing is assigned', () => {
    assert.deepEqual(uncoveredForest(fixture()), [
      {
        id: 'app',
        children: [
          {
            id: 'auth',
            children: [
              { id: 'login', children: [] },
              { id: 'signup', children: [] },
            ],
          },
          { id: 'billing', children: [] },
        ],
      },
    ]);
  });

  it('prunes a covered branch entirely, keeping uncovered siblings', () => {
    const g = assignToGroup(fixture(), 'auth', 'epicA');
    assert.deepEqual(uncoveredForest(g), [
      { id: 'app', children: [{ id: 'billing', children: [] }] },
    ]);
  });

  it('prunes only a covered island, surfacing its uncovered sibling', () => {
    const g = assignToGroup(fixture(), 'login', 'epicA');
    assert.deepEqual(uncoveredForest(g), [
      {
        id: 'app',
        children: [
          { id: 'auth', children: [{ id: 'signup', children: [] }] },
          { id: 'billing', children: [] },
        ],
      },
    ]);
  });

  it('is empty once the root is covered', () => {
    const g = assignToGroup(fixture(), 'app', 'block1');
    assert.deepEqual(uncoveredForest(g), []);
  });
});

describe('isEmptyLeafGroup', () => {
  it('is true for a leaf group with no members, false once filled', () => {
    const g = fixture();
    assert.equal(isEmptyLeafGroup(g, 'epicA'), true);
    assert.equal(isEmptyLeafGroup(assignToGroup(g, 'login', 'epicA'), 'epicA'), false);
  });

  it('is false for a group that has child groups', () => {
    assert.equal(isEmptyLeafGroup(fixture(), 'block1'), false, 'block1 nests epicA/epicB');
  });

  it('is false for work nodes', () => {
    assert.equal(isEmptyLeafGroup(fixture(), 'login'), false);
  });
});

describe('rootGroupOf', () => {
  it('walks up to the delivery-tree root', () => {
    const g = fixture();
    assert.equal(rootGroupOf(g, 'epicA'), 'block1');
    assert.equal(rootGroupOf(g, 'block1'), 'block1');
    assert.equal(rootGroupOf(g, 'block2'), 'block2');
  });
});
