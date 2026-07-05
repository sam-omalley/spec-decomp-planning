import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GraphError,
  addEdge,
  assignToGroup,
  childrenOf,
  createGroup,
  createNode,
  deleteNode,
  edgeBetween,
  emptyGraph,
  groupOf,
  groupRootsOf,
  membersOfGroup,
  moveNode,
  parentOf,
  removeFromGroup,
  rootsOf,
  subtreeIds,
  updateNode,
} from './graph.ts';
import { deserializeProject, serializeProject } from './serialize.ts';
import type { ProjectGraph } from './types.ts';

/** auth ─┬─ login ─┬─ password
 *        │         └─ oauth
 *        └─ reset                */
function fixture(): ProjectGraph {
  let g = emptyGraph();
  g = createNode(g, { id: 'auth', title: 'Authentication', type: 'feature' });
  g = createNode(g, { id: 'login', title: 'Login' }, 'auth');
  g = createNode(g, { id: 'password', title: 'Username/password' }, 'login');
  g = createNode(g, { id: 'oauth', title: 'OAuth' }, 'login');
  g = createNode(g, { id: 'reset', title: 'Password reset' }, 'auth');
  return g;
}

/** Delivery tree: block1 ─┬─ epicA
 *                         └─ epicB   */
function planned(): ProjectGraph {
  let g = fixture();
  g = createGroup(g, { id: 'block1', title: 'Block 1' });
  g = createGroup(g, { id: 'epicA', title: 'Epic A' }, 'block1');
  g = createGroup(g, { id: 'epicB', title: 'Epic B' }, 'block1');
  g = assignToGroup(g, 'oauth', 'epicA');
  g = assignToGroup(g, 'password', 'epicA');
  return g;
}

describe('node creation and the contains tree', () => {
  it('creates nodes with defaults and parents them', () => {
    const g = fixture();
    assert.equal(g.nodes['login']!.status, 'not_started');
    assert.equal(g.nodes['login']!.type, 'task');
    assert.equal(parentOf(g, 'login'), 'auth');
    assert.deepEqual(childrenOf(g, 'auth'), ['login', 'reset']);
    assert.deepEqual(rootsOf(g), ['auth']);
  });

  it('preserves sibling order by insertion', () => {
    const g = fixture();
    assert.deepEqual(childrenOf(g, 'login'), ['password', 'oauth']);
  });

  it('rejects duplicate ids', () => {
    assert.throws(
      () => createNode(fixture(), { id: 'auth', title: 'again' }),
      GraphError,
    );
  });

  it('enforces single parent', () => {
    const g = fixture();
    assert.throws(
      () => addEdge(g, { type: 'contains', from: 'reset', to: 'oauth' }),
      /already has a parent/,
    );
  });

  it('rejects contains cycles', () => {
    let g = fixture();
    const detached = moveNode(g, 'auth', null);
    assert.throws(
      () => addEdge(detached, { type: 'contains', from: 'oauth', to: 'auth' }),
      /cycle/,
    );
  });

  it('rejects self-edges', () => {
    assert.throws(
      () => addEdge(fixture(), { type: 'contains', from: 'auth', to: 'auth' }),
      GraphError,
    );
  });

  it('updateNode patches fields and bumps modifiedAt', () => {
    const g = fixture();
    const updated = updateNode(g, 'oauth', { status: 'in_progress', effort: 5 });
    assert.equal(updated.nodes['oauth']!.status, 'in_progress');
    assert.equal(updated.nodes['oauth']!.effort, 5);
    assert.equal(g.nodes['oauth']!.status, 'not_started', 'original untouched');
  });
});

describe('moveNode', () => {
  it('reparents without touching other relationships', () => {
    let g = fixture();
    g = addEdge(g, { type: 'depends_on', from: 'oauth', to: 'password' });
    g = moveNode(g, 'oauth', 'reset');
    assert.equal(parentOf(g, 'oauth'), 'reset');
    assert.ok(edgeBetween(g, 'depends_on', 'oauth', 'password'), 'dependency survives');
  });

  it('places the node at a specific sibling index', () => {
    let g = fixture();
    g = moveNode(g, 'reset', 'login', 0);
    assert.deepEqual(childrenOf(g, 'login'), ['reset', 'password', 'oauth']);
  });

  it('moves to root when parent is null', () => {
    const g = moveNode(fixture(), 'login', null);
    assert.deepEqual(rootsOf(g).sort(), ['auth', 'login']);
  });

  it('rejects moving a node into its own subtree', () => {
    assert.throws(() => moveNode(fixture(), 'auth', 'oauth'), /cycle/);
  });
});

describe('groups and the delivery tree', () => {
  it('groups nest in groups, at any depth, with sibling order', () => {
    let g = planned();
    g = createGroup(g, { id: 'sub', title: 'Sub-epic' }, 'epicA');
    assert.deepEqual(groupRootsOf(g), ['block1']);
    assert.deepEqual(childrenOf(g, 'block1'), ['epicA', 'epicB']);
    assert.deepEqual(childrenOf(g, 'epicA'), ['sub']);
    assert.deepEqual([...subtreeIds(g, 'block1')].sort(), ['block1', 'epicA', 'epicB', 'sub']);
  });

  it('group roots are ordered and reorderable like work roots', () => {
    let g = planned();
    g = createGroup(g, { id: 'block2', title: 'Block 2' });
    assert.deepEqual(groupRootsOf(g), ['block1', 'block2']);
    g = moveNode(g, 'block2', null, 0);
    assert.deepEqual(groupRootsOf(g), ['block2', 'block1']);
    assert.deepEqual(rootsOf(g), ['auth'], 'work roots untouched');
  });

  it("'contains' never crosses sides, in either direction", () => {
    const g = planned();
    assert.throws(
      () => addEdge(g, { type: 'contains', from: 'block1', to: 'reset' }),
      /cannot cross sides/,
    );
    assert.throws(
      () => addEdge(g, { type: 'contains', from: 'auth', to: 'epicA' }),
      /cannot cross sides/,
    );
  });

  it('group cycles are rejected like work cycles', () => {
    let g = planned();
    const detached = moveNode(g, 'block1', null);
    assert.throws(
      () => addEdge(detached, { type: 'contains', from: 'epicA', to: 'block1' }),
      /cycle/,
    );
  });
});

describe('assignment (work → group)', () => {
  it('assigns work nodes to groups at any depth', () => {
    let g = planned();
    g = assignToGroup(g, 'reset', 'block1');
    assert.equal(groupOf(g, 'reset'), 'block1');
    assert.deepEqual(membersOfGroup(g, 'epicA').sort(), ['oauth', 'password']);
  });

  it('membership is single: assigning again moves, atomically', () => {
    let g = planned();
    g = assignToGroup(g, 'oauth', 'epicB');
    assert.equal(groupOf(g, 'oauth'), 'epicB');
    assert.deepEqual(membersOfGroup(g, 'epicA'), ['password']);
  });

  it('assigning to the current group is an identity no-op', () => {
    const g = planned();
    assert.equal(assignToGroup(g, 'oauth', 'epicA'), g);
  });

  it('raw addEdge rejects a second assignment', () => {
    assert.throws(
      () => addEdge(planned(), { type: 'assigned_to', from: 'oauth', to: 'epicB' }),
      /already assigned/,
    );
  });

  it('rejects assigning a group or assigning to a non-group', () => {
    const g = planned();
    assert.throws(
      () => addEdge(g, { type: 'assigned_to', from: 'epicA', to: 'epicB' }),
      /Groups cannot be assigned/,
    );
    assert.throws(
      () => addEdge(g, { type: 'assigned_to', from: 'oauth', to: 'reset' }),
      /must be a group/,
    );
  });

  it('assignment never alters the spec tree', () => {
    const g = planned();
    const before = fixture();
    assert.equal(parentOf(g, 'oauth'), parentOf(before, 'oauth'));
    assert.deepEqual(childrenOf(g, 'login'), childrenOf(before, 'login'));
    assert.deepEqual(rootsOf(g), rootsOf(before));
  });

  it('allows assigning a non-leaf node', () => {
    let g = planned();
    g = assignToGroup(g, 'login', 'epicB');
    assert.equal(groupOf(g, 'login'), 'epicB');
  });

  it('removeFromGroup unassigns; unassigned nodes throw', () => {
    let g = planned();
    g = removeFromGroup(g, 'oauth');
    assert.equal(groupOf(g, 'oauth'), null);
    assert.throws(() => removeFromGroup(g, 'oauth'), /not assigned/);
  });
});

describe('cascade delete', () => {
  it('removes the work subtree and every touching edge', () => {
    let g = planned();
    g = createNode(g, { id: 'db', title: 'User database' });
    g = addEdge(g, { type: 'depends_on', from: 'oauth', to: 'db' });

    g = deleteNode(g, 'login');

    assert.deepEqual([...subtreeIds(g, 'auth')].sort(), ['auth', 'reset']);
    assert.equal(g.nodes['oauth'], undefined);
    assert.equal(edgeBetween(g, 'depends_on', 'oauth', 'db'), undefined);
    assert.deepEqual(membersOfGroup(g, 'epicA'), []);
    assert.ok(g.nodes['db'], 'unrelated node survives');
    assert.ok(g.nodes['epicA'], 'group itself survives');
  });

  it('deleting a group subtree removes assignments but never work nodes', () => {
    let g = planned();
    g = deleteNode(g, 'block1');
    assert.equal(g.nodes['epicA'], undefined);
    assert.equal(g.nodes['epicB'], undefined);
    assert.ok(g.nodes['oauth'], 'work node survives');
    assert.equal(groupOf(g, 'oauth'), null);
    assert.deepEqual(groupRootsOf(g), []);
    assert.equal(parentOf(g, 'oauth'), 'login', 'spec tree untouched');
  });
});

describe('dependencies', () => {
  it('rejects dependencies touching groups', () => {
    const g = planned();
    assert.throws(
      () => addEdge(g, { type: 'depends_on', from: 'oauth', to: 'epicA' }),
      /connect work nodes/,
    );
    assert.throws(
      () => addEdge(g, { type: 'blocks', from: 'block1', to: 'oauth' }),
      /connect work nodes/,
    );
  });

  it('allows dependency cycles (they are visualized, not forbidden)', () => {
    let g = fixture();
    g = addEdge(g, { type: 'depends_on', from: 'oauth', to: 'password' });
    g = addEdge(g, { type: 'depends_on', from: 'password', to: 'oauth' });
    assert.ok(edgeBetween(g, 'depends_on', 'oauth', 'password'));
    assert.ok(edgeBetween(g, 'depends_on', 'password', 'oauth'));
  });
});

describe('serialization', () => {
  it('round-trips a project with a delivery tree', () => {
    const g = planned();
    const restored = deserializeProject(serializeProject(g));
    assert.deepEqual(restored, g);
  });

  it('rejects malformed and corrupt files', () => {
    assert.throws(() => deserializeProject('not json'), /malformed/);
    assert.throws(() => deserializeProject('{"version":99}'), /version/);
    const g = fixture();
    const text = serializeProject(g).replace('"auth"', '"ghost"');
    assert.throws(() => deserializeProject(text), GraphError);
  });
});
