import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GraphError,
  addEdge,
  assignToEpic,
  childrenOf,
  createEpic,
  createNode,
  createPlan,
  deleteNode,
  deletePlan,
  edgeBetween,
  emptyGraph,
  epicsOfNode,
  epicsOfPlan,
  membersOfEpic,
  moveNode,
  parentOf,
  removeFromEpic,
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

describe('cascade delete', () => {
  it('removes the subtree and every touching edge', () => {
    let g = fixture();
    g = createNode(g, { id: 'db', title: 'User database' });
    g = addEdge(g, { type: 'depends_on', from: 'oauth', to: 'db' });
    g = createPlan(g, { id: 'p1', name: 'MVP first' });
    g = createEpic(g, 'p1', { id: 'e1', title: 'Auth epic' });
    g = assignToEpic(g, 'oauth', 'e1');

    g = deleteNode(g, 'login');

    assert.deepEqual([...subtreeIds(g, 'auth')].sort(), ['auth', 'reset']);
    assert.equal(g.nodes['oauth'], undefined);
    assert.equal(edgeBetween(g, 'depends_on', 'oauth', 'db'), undefined);
    assert.deepEqual(membersOfEpic(g, 'e1'), []);
    assert.ok(g.nodes['db'], 'unrelated node survives');
    assert.ok(g.nodes['e1'], 'epic itself survives');
  });
});

describe('plans and epics', () => {
  function planned(): ProjectGraph {
    let g = fixture();
    g = createPlan(g, { id: 'p1', name: 'MVP first' });
    g = createPlan(g, { id: 'p2', name: 'Infra first' });
    g = createEpic(g, 'p1', { id: 'e1', title: 'Login MVP' });
    g = createEpic(g, 'p2', { id: 'e2', title: 'Auth infra' });
    g = assignToEpic(g, 'oauth', 'e1');
    g = assignToEpic(g, 'oauth', 'e2');
    g = assignToEpic(g, 'password', 'e1');
    return g;
  }

  it('scopes epics to plans', () => {
    const g = planned();
    assert.deepEqual(epicsOfPlan(g, 'p1'), ['e1']);
    assert.deepEqual(epicsOfPlan(g, 'p2'), ['e2']);
  });

  it('lets one node belong to epics in different plans', () => {
    const g = planned();
    assert.deepEqual(epicsOfNode(g, 'oauth').sort(), ['e1', 'e2']);
  });

  it('epic membership never alters the spec tree', () => {
    const g = planned();
    const before = fixture();
    assert.equal(parentOf(g, 'oauth'), parentOf(before, 'oauth'));
    assert.deepEqual(childrenOf(g, 'login'), childrenOf(before, 'login'));
    assert.deepEqual(rootsOf(g), rootsOf(before));
  });

  it('moving a node between epics only swaps membership edges', () => {
    let g = planned();
    g = removeFromEpic(g, 'password', 'e1');
    g = assignToEpic(g, 'password', 'e2');
    assert.deepEqual(membersOfEpic(g, 'e1'), ['oauth']);
    assert.deepEqual(membersOfEpic(g, 'e2').sort(), ['oauth', 'password']);
    assert.equal(parentOf(g, 'password'), 'login', 'tree untouched');
  });

  it('allows assigning a non-leaf node to an epic', () => {
    let g = planned();
    g = assignToEpic(g, 'login', 'e1');
    assert.ok(membersOfEpic(g, 'e1').includes('login'));
  });

  it('rejects membership pointing at a non-epic', () => {
    assert.throws(
      () => addEdge(planned(), { type: 'belongs_to_epic', from: 'oauth', to: 'reset' }),
      /must be an epic/,
    );
  });

  it('rejects epics in the contains tree', () => {
    assert.throws(
      () => addEdge(planned(), { type: 'contains', from: 'auth', to: 'e1' }),
      /Epics cannot participate/,
    );
  });

  it('rejects duplicate membership', () => {
    assert.throws(() => assignToEpic(planned(), 'oauth', 'e1'), /Duplicate/);
  });

  it('deleting a plan removes its epics but nothing else', () => {
    let g = planned();
    g = deletePlan(g, 'p1');
    assert.equal(g.plans['p1'], undefined);
    assert.equal(g.nodes['e1'], undefined);
    assert.ok(g.nodes['oauth'], 'member task survives');
    assert.deepEqual(epicsOfNode(g, 'oauth'), ['e2'], 'other plan untouched');
    assert.equal(parentOf(g, 'oauth'), 'login', 'tree untouched');
  });
});

describe('dependencies', () => {
  it('allows dependency cycles (they are visualized, not forbidden)', () => {
    let g = fixture();
    g = addEdge(g, { type: 'depends_on', from: 'oauth', to: 'password' });
    g = addEdge(g, { type: 'depends_on', from: 'password', to: 'oauth' });
    assert.ok(edgeBetween(g, 'depends_on', 'oauth', 'password'));
    assert.ok(edgeBetween(g, 'depends_on', 'password', 'oauth'));
  });
});

describe('serialization', () => {
  it('round-trips a project', () => {
    let g = fixture();
    g = createPlan(g, { id: 'p1', name: 'MVP' });
    g = createEpic(g, 'p1', { id: 'e1', title: 'Epic' });
    g = assignToEpic(g, 'oauth', 'e1');
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
