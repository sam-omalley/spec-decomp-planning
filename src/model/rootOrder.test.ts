import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addEdge,
  createGroup,
  createNode,
  deleteNode,
  emptyGraph,
  groupOf,
  groupRootsOf,
  moveNode,
  parentOf,
  removeEdge,
  rootsOf,
} from './graph.ts';
import { deserializeProject, serializeProject } from './serialize.ts';
import type { ProjectGraph } from './types.ts';

function threeRoots(): ProjectGraph {
  let g = emptyGraph();
  g = createNode(g, { id: 'a', title: 'A' });
  g = createNode(g, { id: 'b', title: 'B' });
  g = createNode(g, { id: 'c', title: 'C' });
  return g;
}

describe('rootOrder maintenance', () => {
  it('new roots append in creation order; children never enter it', () => {
    let g = threeRoots();
    g = createNode(g, { id: 'a1', title: 'A1' }, 'a');
    assert.deepEqual(rootsOf(g), ['a', 'b', 'c']);
  });

  it('the two sides keep separate root orders', () => {
    let g = threeRoots();
    g = createGroup(g, { id: 'e', title: 'E' });
    assert.deepEqual(rootsOf(g), ['a', 'b', 'c']);
    assert.deepEqual(groupRootsOf(g), ['e']);
    g = createGroup(g, { id: 'f', title: 'F' }, 'e');
    assert.deepEqual(groupRootsOf(g), ['e'], 'nested group is not a root');
  });

  it('gaining a parent leaves the root order; losing it re-roots at the end', () => {
    let g = threeRoots();
    g = addEdge(g, { id: 'edge1', type: 'contains', from: 'a', to: 'b' });
    assert.deepEqual(rootsOf(g), ['a', 'c']);
    g = removeEdge(g, 'edge1');
    assert.deepEqual(rootsOf(g), ['a', 'c', 'b']);
  });

  it('moveNode to root honours the index', () => {
    let g = threeRoots();
    g = moveNode(g, 'c', null, 0);
    assert.deepEqual(rootsOf(g), ['c', 'a', 'b']);
    g = moveNode(g, 'c', 'a');
    assert.deepEqual(rootsOf(g), ['a', 'b']);
    g = moveNode(g, 'c', null, 1);
    assert.deepEqual(rootsOf(g), ['a', 'c', 'b']);
    assert.equal(parentOf(g, 'c'), null);
  });

  it('deleting a subtree removes its root from the order', () => {
    let g = threeRoots();
    g = createNode(g, { id: 'b1', title: 'B1' }, 'b');
    g = deleteNode(g, 'b');
    assert.deepEqual(rootsOf(g), ['a', 'c']);
  });
});

describe('serialization of rootOrder', () => {
  it('round-trips a reordered graph', () => {
    let g = threeRoots();
    g = moveNode(g, 'c', null, 0);
    const restored = deserializeProject(serializeProject(g));
    assert.deepEqual(rootsOf(restored), ['c', 'a', 'b']);
  });

  it('migrates v1 files (no rootOrder) using createdAt order', () => {
    const g = threeRoots();
    const v1 = JSON.parse(serializeProject(g));
    v1.version = 1;
    delete v1.graph.rootOrder;
    // make creation order differ from object-key order
    v1.graph.nodes['a'].createdAt = '2026-01-03T00:00:00Z';
    v1.graph.nodes['b'].createdAt = '2026-01-01T00:00:00Z';
    v1.graph.nodes['c'].createdAt = '2026-01-02T00:00:00Z';
    const restored = deserializeProject(JSON.stringify(v1));
    assert.deepEqual(rootsOf(restored), ['b', 'c', 'a']);
  });

  it('reconciles a corrupt rootOrder: drops stale ids, appends missing roots', () => {
    const g = threeRoots();
    const file = JSON.parse(serializeProject(g));
    file.graph.rootOrder = ['c', 'ghost', 'c'];
    const restored = deserializeProject(JSON.stringify(file));
    assert.deepEqual(rootsOf(restored), ['c', 'a', 'b']);
  });

  it('migrates v2 files: plans become root groups, epics their children, memberships single', () => {
    const epicNode = (id: string, title: string, planId: string, createdAt: string) => ({
      id,
      title,
      description: '',
      type: 'epic',
      status: 'not_started',
      priority: 'medium',
      effort: null,
      tags: [],
      notes: '',
      planId,
      createdAt,
      modifiedAt: createdAt,
    });
    const g = threeRoots();
    const file = JSON.parse(serializeProject(g));
    file.version = 2;
    delete file.graph.groupRootOrder;
    file.graph.plans = {
      p1: { id: 'p1', name: 'MVP first', createdAt: '2026-01-01T00:00:00Z' },
      p2: { id: 'p2', name: 'Infra first', createdAt: '2026-01-02T00:00:00Z' },
    };
    file.graph.nodes['e1'] = epicNode('e1', 'Epic 1', 'p1', '2026-01-03T00:00:00Z');
    file.graph.nodes['e2'] = epicNode('e2', 'Epic 2', 'p1', '2026-01-04T00:00:00Z');
    file.graph.nodes['e3'] = epicNode('e3', 'Epic 3', 'p2', '2026-01-05T00:00:00Z');
    file.graph.edges['m1'] = { id: 'm1', type: 'belongs_to_epic', from: 'a', to: 'e1' };
    file.graph.edges['m2'] = { id: 'm2', type: 'belongs_to_epic', from: 'a', to: 'e3' };
    file.graph.edges['m3'] = { id: 'm3', type: 'belongs_to_epic', from: 'b', to: 'e2' };

    const restored = deserializeProject(JSON.stringify(file));

    assert.deepEqual(groupRootsOf(restored), ['p1', 'p2']);
    assert.equal(restored.nodes['p1']!.title, 'MVP first');
    assert.equal(restored.nodes['p1']!.type, 'group');
    assert.equal(restored.nodes['e1']!.type, 'group');
    assert.equal(parentOf(restored, 'e1'), 'p1');
    assert.equal(parentOf(restored, 'e2'), 'p1');
    assert.equal(parentOf(restored, 'e3'), 'p2');
    assert.equal(groupOf(restored, 'a'), 'e1', 'first membership wins');
    assert.equal(groupOf(restored, 'b'), 'e2');
    assert.equal(
      Object.values(restored.edges).filter((e) => e.type === 'assigned_to').length,
      2,
      'duplicate memberships dropped',
    );
    assert.deepEqual(rootsOf(restored), ['a', 'b', 'c'], 'work roots untouched');
  });
});
