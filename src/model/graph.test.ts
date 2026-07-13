import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GraphError,
  addEdge,
  addExternalRef,
  addResource,
  assignResource,
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
  removeExternalRef,
  removeFromGroup,
  removeResource,
  rootsOf,
  setActualDates,
  setEstimate,
  subtreeIds,
  updateNode,
  updateResource,
  updateSettings,
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
    let g = planned();
    g = addEdge(g, { type: 'depends_on', from: 'epicA', to: 'epicB' });
    g = moveNode(g, 'epicA', null);
    assert.equal(parentOf(g, 'epicA'), null);
    assert.ok(edgeBetween(g, 'depends_on', 'epicA', 'epicB'), 'dependency survives');
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

    g = deleteNode(g, 'login');

    assert.deepEqual([...subtreeIds(g, 'auth')].sort(), ['auth', 'reset']);
    assert.equal(g.nodes['oauth'], undefined);
    // The deleted work subtree's assignment edge (oauth → epicA) is gone.
    assert.deepEqual(membersOfGroup(g, 'epicA'), []);
    assert.ok(g.nodes['db'], 'unrelated node survives');
    assert.ok(g.nodes['epicA'], 'group itself survives');
  });

  it('deleting a group subtree removes assignments but never work nodes', () => {
    let g = planned();
    g = addEdge(g, { type: 'depends_on', from: 'epicA', to: 'epicB' });
    g = deleteNode(g, 'block1');
    assert.equal(g.nodes['epicA'], undefined);
    assert.equal(g.nodes['epicB'], undefined);
    assert.equal(edgeBetween(g, 'depends_on', 'epicA', 'epicB'), undefined, 'group dep cascaded');
    assert.ok(g.nodes['oauth'], 'work node survives');
    assert.equal(groupOf(g, 'oauth'), null);
    assert.deepEqual(groupRootsOf(g), []);
    assert.equal(parentOf(g, 'oauth'), 'login', 'spec tree untouched');
  });
});

describe('dependencies', () => {
  it('connects groups and rejects any dep touching a work node', () => {
    let g = planned();
    g = addEdge(g, { type: 'depends_on', from: 'epicA', to: 'epicB' });
    assert.ok(edgeBetween(g, 'depends_on', 'epicA', 'epicB'), 'group dep allowed');
    assert.throws(
      () => addEdge(g, { type: 'depends_on', from: 'oauth', to: 'password' }),
      /structural/,
    );
    assert.throws(
      () => addEdge(g, { type: 'blocks', from: 'oauth', to: 'epicA' }),
      /structural/,
    );
  });

  it('allows dependency cycles (they are visualized, not forbidden)', () => {
    let g = planned();
    g = addEdge(g, { type: 'depends_on', from: 'epicA', to: 'epicB' });
    g = addEdge(g, { type: 'depends_on', from: 'epicB', to: 'epicA' });
    assert.ok(edgeBetween(g, 'depends_on', 'epicA', 'epicB'));
    assert.ok(edgeBetween(g, 'depends_on', 'epicB', 'epicA'));
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

  it('round-trips estimates, actuals, external refs and settings', () => {
    let g = fixture();
    g = setEstimate(g, 'login', { effort: 5, durationEstimate: 3 });
    g = setActualDates(g, 'login', { actualStart: '2026-07-01' });
    g = addExternalRef(g, 'login', { system: 'jira', key: 'PT-1', url: 'http://x/PT-1' });
    g = updateSettings(g, {
      resources: [{ id: 'r1', name: 'Ada', fte: 0.8 }],
      speedMultiplier: 1.5,
      targetDate: '2026-12-01',
    });
    g = updateSettings(g, { specLockDepth: 1, planLockDepth: 2 });
    assert.deepEqual(deserializeProject(serializeProject(g)), g);
  });

  it('migrates a v3 file by backfilling the new fields and settings', () => {
    const v3 = {
      version: 3,
      savedAt: '2026-01-01T00:00:00.000Z',
      graph: {
        nodes: {
          a: {
            id: 'a', title: 'A', description: '', type: 'task',
            status: 'not_started', priority: 'medium', effort: null,
            tags: [], notes: '',
            createdAt: '2026-01-01T00:00:00.000Z',
            modifiedAt: '2026-01-01T00:00:00.000Z',
          },
        },
        edges: {},
        rootOrder: ['a'],
        groupRootOrder: [],
      },
    };
    const g = deserializeProject(JSON.stringify(v3));
    assert.deepEqual(g.nodes['a']!.externalRefs, []);
    assert.equal(g.nodes['a']!.durationEstimate, null);
    assert.equal(g.nodes['a']!.actualStart, null);
    assert.equal(g.nodes['a']!.actualFinish, null);
    // Absent settings become the neutral defaults.
    assert.deepEqual(g.settings.resources, []);
    assert.equal(g.settings.hoursPerWeek, 38);
    assert.equal(g.settings.speedMultiplier, 1);
    assert.equal(g.settings.targetDate, null);
    assert.equal(g.nodes['a']!.resourceId, null); // v6 field backfilled
    // Lock depths (v5) backfill to unlocked.
    assert.equal(g.settings.specLockDepth, 0);
    assert.equal(g.settings.planLockDepth, 0);
  });

  it('migrates a v5 file to resourcing (parallelTracks → team, hours/day → hours/week)', () => {
    // A v5-shaped settings blob: the old capacity/conversion fields.
    const v5 = {
      version: 5,
      savedAt: '2026-01-01T00:00:00.000Z',
      graph: {
        nodes: {},
        edges: {},
        rootOrder: [],
        groupRootOrder: [],
        settings: {
          startDate: '2026-01-01', targetDate: null, pointsPerDay: 1,
          hoursPerDay: 8, parallelTracks: 3, speedMultiplier: 1,
          specLockDepth: 0, planLockDepth: 0,
        },
      },
    };
    const g = deserializeProject(JSON.stringify(v5));
    // parallelTracks: 3 → three generic full-time resources (capacity kept).
    assert.equal(g.settings.resources.length, 3);
    assert.ok(g.settings.resources.every((r) => r.fte === 1 && r.name !== ''));
    assert.equal(g.settings.hoursPerWeek, 40); // 8 × 5
    assert.equal('parallelTracks' in g.settings, false);
    assert.equal('hoursPerDay' in g.settings, false);
  });

  it('keeps a single legacy track as an empty team', () => {
    const v5 = {
      version: 5,
      savedAt: '2026-01-01T00:00:00.000Z',
      graph: {
        nodes: {}, edges: {}, rootOrder: [], groupRootOrder: [],
        settings: { startDate: '2026-01-01', parallelTracks: 1, hoursPerDay: 7.6 },
      },
    };
    const g = deserializeProject(JSON.stringify(v5));
    assert.deepEqual(g.settings.resources, []); // one track ⇒ no explicit team
    assert.equal(g.settings.hoursPerWeek, 38); // 7.6 × 5
  });

  it('fills defaults for a partial/garbage settings blob', () => {
    let g = fixture();
    const file = JSON.parse(serializeProject(g)) as {
      graph: { settings: unknown };
    };
    file.graph.settings = { hoursPerWeek: 30, speedMultiplier: 'fast' };
    const restored = deserializeProject(JSON.stringify(file));
    assert.equal(restored.settings.hoursPerWeek, 30); // kept
    assert.equal(restored.settings.speedMultiplier, 1); // garbage → default
    assert.deepEqual(restored.settings.resources, []); // missing → default
  });
});

describe('estimation and progress (project-management extension)', () => {
  it('sets the two estimate axes independently, and clears with null', () => {
    let g = fixture();
    g = setEstimate(g, 'login', { effort: 8 });
    assert.equal(g.nodes['login']!.effort, 8);
    assert.equal(g.nodes['login']!.durationEstimate, null); // untouched
    g = setEstimate(g, 'login', { durationEstimate: 4 });
    assert.equal(g.nodes['login']!.effort, 8); // untouched
    assert.equal(g.nodes['login']!.durationEstimate, 4);
    g = setEstimate(g, 'login', { effort: null });
    assert.equal(g.nodes['login']!.effort, null);
  });

  it('rejects negative estimates', () => {
    const g = fixture();
    assert.throws(() => setEstimate(g, 'login', { effort: -1 }), /negative/);
    assert.throws(() => setEstimate(g, 'login', { durationEstimate: -2 }), /negative/);
  });

  it('auto-derives status from actual dates', () => {
    let g = fixture();
    g = setActualDates(g, 'login', { actualStart: '2026-07-01' });
    assert.equal(g.nodes['login']!.status, 'in_progress');
    g = setActualDates(g, 'login', { actualFinish: '2026-07-05' });
    assert.equal(g.nodes['login']!.status, 'done');
    // Clearing the finish while still started reverts to in_progress.
    g = setActualDates(g, 'login', { actualFinish: null });
    assert.equal(g.nodes['login']!.status, 'in_progress');
  });

  it('lets a manually blocked-but-started item stay blocked', () => {
    let g = fixture();
    g = updateNode(g, 'login', { status: 'blocked' });
    g = setActualDates(g, 'login', { actualStart: '2026-07-01' });
    assert.equal(g.nodes['login']!.status, 'blocked');
    // ...but finishing it still marks it done.
    g = setActualDates(g, 'login', { actualFinish: '2026-07-05' });
    assert.equal(g.nodes['login']!.status, 'done');
  });

  it('leaves status untouched when no actual dates are set', () => {
    let g = fixture();
    g = updateNode(g, 'login', { status: 'blocked' });
    g = setActualDates(g, 'login', {});
    assert.equal(g.nodes['login']!.status, 'blocked');
  });
});

describe('external refs and settings', () => {
  it('adds, dedupes and removes external refs', () => {
    let g = fixture();
    g = addExternalRef(g, 'login', { system: 'jira', key: 'PT-1' });
    g = addExternalRef(g, 'login', { system: 'github', key: '42', url: 'http://x/42' });
    assert.equal(g.nodes['login']!.externalRefs.length, 2);
    assert.throws(() => addExternalRef(g, 'login', { system: 'jira', key: 'PT-1' }), /Duplicate/);
    assert.throws(() => addExternalRef(g, 'login', { system: '', key: 'x' }), /system/);
    g = removeExternalRef(g, 'login', 'jira', 'PT-1');
    assert.deepEqual(g.nodes['login']!.externalRefs, [
      { system: 'github', key: '42', url: 'http://x/42' },
    ]);
    assert.throws(() => removeExternalRef(g, 'login', 'jira', 'PT-1'), /No external ref/);
  });

  it('validates capacity and conversion settings', () => {
    const g = fixture();
    assert.equal(updateSettings(g, { hoursPerWeek: 30 }).settings.hoursPerWeek, 30);
    assert.throws(() => updateSettings(g, { hoursPerWeek: 0 }), /hoursPerWeek/);
    assert.throws(() => updateSettings(g, { speedMultiplier: 0 }), /speedMultiplier/);
    assert.throws(() => updateSettings(g, { pointsPerDay: -1 }), /pointsPerDay/);
    assert.equal(updateSettings(g, { specLockDepth: 0 }).settings.specLockDepth, 0);
    assert.equal(updateSettings(g, { planLockDepth: 3 }).settings.planLockDepth, 3);
    assert.throws(() => updateSettings(g, { specLockDepth: -1 }), /specLockDepth/);
    assert.throws(() => updateSettings(g, { planLockDepth: 1.5 }), /planLockDepth/);
  });

  it('manages the resource team and pins assignments', () => {
    let g = fixture();
    g = addResource(g, { id: 'r1', name: 'Ada', fte: 0.8 });
    g = addResource(g, { id: 'r2', name: 'Grace' }); // fte defaults to 1
    assert.equal(g.settings.resources.length, 2);
    assert.equal(g.settings.resources[1]!.fte, 1);
    assert.throws(() => addResource(g, { id: 'r1', name: 'Dup' }), /duplicate resource id/);
    assert.throws(() => addResource(g, { id: 'r3', name: 'X', fte: 0 }), /fte/);

    g = updateResource(g, 'r1', { fte: 0.5 });
    assert.equal(g.settings.resources[0]!.fte, 0.5);
    assert.throws(() => updateResource(g, 'nope', { fte: 1 }), /No resource/);

    // Assignment must reference a real resource; clears with null.
    g = assignResource(g, 'login', 'r1');
    assert.equal(g.nodes['login']!.resourceId, 'r1');
    assert.throws(() => assignResource(g, 'login', 'ghost'), /No resource/);

    // Removing a resource clears it from every assigned node.
    g = removeResource(g, 'r1');
    assert.equal(g.settings.resources.length, 1);
    assert.equal(g.nodes['login']!.resourceId, null);
    assert.throws(() => removeResource(g, 'r1'), /No resource/);
  });
});
